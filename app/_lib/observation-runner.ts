/**
 * Observation Runner Shared Helpers
 *
 * Bounded concurrency, fetch timeouts, and web enrichment gating
 * for the monitoring observation pipeline.
 */

import { recordObservation, type MonitorEntry, type ObservedState } from './monitor-inventory';
import { runWebEnrichment } from './web-search-enrichment';

// ---- Constants ----

const DAY_MS = 24 * 60 * 60 * 1000;

/** Maximum concurrent Places API calls */
export const MAX_CONCURRENT_PLACES = 3;

/** Timeout for Places API fetch (ms) */
export const PLACES_FETCH_TIMEOUT_MS = 8000;

/** Maximum web enrichments per observation run (gated to preserve quota) */
export const MAX_WEB_ENRICHMENTS_PER_RUN = 2;

// ---- Types ----

export interface PlaceData {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  priceLevel?: string;
  editorialSummary?: { text?: string };
}

export interface ObservationResult {
  entryId: string;
  name: string;
  status: 'observed' | 'skipped-no-place-id' | 'skipped-fetch-failed' | 'skipped-timeout';
  changes?: string[];
  significanceLevel?: string;
  significanceScore?: number;
  significanceSummary?: string;
  nextCheckAt?: string;
  webChanges?: string[];
}

export interface RunSummary {
  observed: number;
  skipped: number;
  withChanges: number;
  withWebSignals: number;
  results: ObservationResult[];
}

// ---- Helper: Fetch with timeout ----

const PLACES_SERVER_KEY = process.env.GOOGLE_PLACES_SERVER_KEY;

export async function fetchPlaceDetailsWithTimeout(placeId: string): Promise<PlaceData | null> {
  if (!PLACES_SERVER_KEY) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLACES_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          'X-Goog-Api-Key': PLACES_SERVER_KEY,
          'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,businessStatus,priceLevel,editorialSummary',
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    // Treat abort (timeout) as null
    if (err instanceof Error && err.name === 'AbortError') {
      console.log(`[observation-runner] Places fetch timeout for ${placeId}`);
      return null;
    }
    console.error(`[observation-runner] Places fetch error for ${placeId}:`, err);
    return null;
  }
}

// ---- Helper: Map price level ----

export function priceLevelToNumber(level?: string): number | undefined {
  if (!level) return undefined;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level];
}

// ---- Helper: Map operational status ----

export function mapBusinessStatus(status?: string): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    OPERATIONAL: 'OPERATIONAL',
    CLOSED_TEMPORARILY: 'CLOSED_TEMPORARILY',
    CLOSED_PERMANENTLY: 'CLOSED_PERMANENTLY',
  };
  return map[status] ?? status;
}

// ---- Helper: Build observed state ----

export function buildObservedState(data: PlaceData): ObservedState {
  const now = new Date().toISOString();
  return {
    observedAt: now,
    source: 'google-places',
    rating: data.rating,
    reviewCount: data.userRatingCount,
    description: data.editorialSummary?.text,
    operationalStatus: mapBusinessStatus(data.businessStatus),
    priceLevel: priceLevelToNumber(data.priceLevel),
  };
}

// ---- Helper: Compute next check time ----

/**
 * Base check interval by monitorType.
 */
export function baseIntervalMs(monitorType: string): number {
  const cadenceMap: Record<string, number> = {
    hospitality: 7 * DAY_MS,   // weekly — restaurants/bars change frequently
    stay: 14 * DAY_MS,        // bi-weekly — hotels/rentals
    development: 14 * DAY_MS, // bi-weekly — construction timelines
    culture: 14 * DAY_MS,     // bi-weekly — museums/galleries
    general: 14 * DAY_MS,     // bi-weekly — default
  };
  return cadenceMap[monitorType] ?? cadenceMap.general ?? 14 * DAY_MS;
}

/**
 * Compute next check time for a monitor entry.
 *
 * Adaptive scheduling:
 *  - critical significance → re-check in 2 days
 *  - notable significance  → re-check in 5 days
 *  - priority status       → halve the base cadence
 *  - routine / noise       → use full base cadence
 */
export function computeNextCheckAt(entry: MonitorEntry, observedAt: string): string {
  const base = baseIntervalMs(entry.monitorType);
  const latestObs = entry.observations?.[0];
  const latestLevel = latestObs?.significanceLevel;

  let intervalMs: number;
  if (latestLevel === 'critical') {
    intervalMs = 2 * DAY_MS;
  } else if (latestLevel === 'notable') {
    intervalMs = 5 * DAY_MS;
  } else {
    intervalMs = entry.monitorStatus === 'priority' ? Math.floor(base * 0.5) : base;
  }

  const baseMs = new Date(observedAt).getTime();
  return new Date(baseMs + intervalMs).toISOString();
}

// ---- Helper: Run bounded concurrent observation ----

/**
 * Run observations for a batch of entries with bounded concurrency.
 * Gates web enrichment to a small capped subset of high-priority entries.
 */
export async function runObservations(params: {
  userId: string;
  entries: MonitorEntry[];
  maxConcurrent?: number;
  maxWebEnrichments?: number;
  dryRun?: boolean;
}): Promise<RunSummary> {
  const { userId, entries, maxConcurrent = MAX_CONCURRENT_PLACES, maxWebEnrichments = MAX_WEB_ENRICHMENTS_PER_RUN, dryRun = false } = params;

  const results: ObservationResult[] = entries
    .filter(entry => !entry.place_id)
    .map(entry => ({
      entryId: entry.id,
      name: entry.name,
      status: 'skipped-no-place-id' as const,
    }));
  let observed = 0;
  let skipped = 0;
  let withChanges = 0;
  let withWebSignals = 0;

  const validEntries = entries.filter(e => e.place_id);
  if (validEntries.length === 0) {
    return { observed: 0, skipped: results.length, withChanges: 0, withWebSignals: 0, results };
  }

  const webEnrichmentCandidates = new Set(
    selectWebEnrichmentCandidates(validEntries, maxWebEnrichments),
  );

  let webEnrichmentCount = 0;

  // Process with bounded concurrency
  const queue = [...validEntries];
  const running: Promise<void>[] = [];

  const processEntry = async (entry: MonitorEntry): Promise<void> => {
    // Places fetch with timeout
    const placeData = await fetchPlaceDetailsWithTimeout(entry.place_id!);
    if (!placeData) {
      results.push({
        entryId: entry.id,
        name: entry.name,
        status: 'skipped-fetch-failed',
      });
      return;
    }

    const observedState = buildObservedState(placeData);
    const now = observedState.observedAt;

    if (dryRun) {
      results.push({
        entryId: entry.id,
        name: entry.name,
        status: 'observed',
        nextCheckAt: computeNextCheckAt(entry, now),
      });
      return;
    }

    // Record the observation
    const nextCheck = computeNextCheckAt(entry, now);
    const updated = await recordObservation({
      userId,
      entryId: entry.id,
      observation: {
        observedAt: now,
        source: 'google-places',
        state: observedState,
      },
      nextCheckAt: nextCheck,
    });

    const latestObs = updated?.observations?.[0];
    const result: ObservationResult = {
      entryId: entry.id,
      name: entry.name,
      status: 'observed',
      changes: latestObs?.changes ?? [],
      significanceLevel: latestObs?.significanceLevel,
      significanceScore: latestObs?.significanceScore,
      significanceSummary: latestObs?.significanceSummary,
      nextCheckAt: updated?.nextCheckAt,
    };

    // Web enrichment (gated to top candidates)
    if (webEnrichmentCandidates.has(entry.id) && webEnrichmentCount < maxWebEnrichments) {
      webEnrichmentCount++;
      const webEnrichment = await runWebEnrichment({
        name: entry.name,
        city: entry.city,
        monitorType: entry.monitorType,
      });
      if (webEnrichment && webEnrichment.changes.length > 0) {
        const webObsAt = new Date().toISOString();
        await recordObservation({
          userId,
          entryId: entry.id,
          observation: {
            observedAt: webObsAt,
            source: 'web-search',
            changes: webEnrichment.changes,
            changeSummary: `Web signals: ${webEnrichment.changes.join(', ')}`,
            state: {
              observedAt: webObsAt,
              source: 'web-search',
              notes: webEnrichment.notes,
            },
          },
        });
        result.webChanges = webEnrichment.changes.map(String);
      }
    }

    results.push(result);
  };

  // Run with bounded concurrency
  for (const entry of queue) {
    // Wait if we've hit the concurrency limit
    if (running.length >= maxConcurrent) {
      await Promise.race(running);
    }

    const promise = processEntry(entry).then(() => {
      running.splice(running.findIndex(p => p === promise), 1);
    });
    running.push(promise);
  }

  // Wait for remaining
  await Promise.all(running);

  // Compute summary from results
  for (const r of results) {
    if (r.status === 'observed') {
      observed++;
      if (r.changes && r.changes.length > 0) withChanges++;
      if (r.webChanges && r.webChanges.length > 0) withWebSignals++;
    } else {
      skipped++;
    }
  }

  return { observed, skipped, withChanges, withWebSignals, results };
}

// ---- Helper: Select web enrichment candidates ----

/**
 * Select entries that should receive web enrichment.
 * Prioritizes: priority status, then highest significance score, then recent changes.
 */
export function selectWebEnrichmentCandidates(entries: MonitorEntry[], limit: number): string[] {
  return entries
    .filter(e => e.place_id)
    .sort((a, b) => {
      // Priority status first
      const statusRank: Record<string, number> = { priority: 0, active: 1, candidate: 2 };
      const aRank = statusRank[a.monitorStatus] ?? 3;
      const bRank = statusRank[b.monitorStatus] ?? 3;
      if (aRank !== bRank) return aRank - bRank;

      // Then significance score (higher first)
      const aScore = a.observations?.[0]?.significanceScore ?? 0;
      const bScore = b.observations?.[0]?.significanceScore ?? 0;
      if (bScore !== aScore) return bScore - aScore;

      // Then recent changes (more = higher priority)
      const aChanges = a.observations?.[0]?.changes?.length ?? 0;
      const bChanges = b.observations?.[0]?.changes?.length ?? 0;
      return bChanges - aChanges;
    })
    .slice(0, limit)
    .map(e => e.id);
}