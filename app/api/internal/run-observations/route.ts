/**
 * POST /api/internal/run-observations
 *
 * Observation runner: fetches fresh data for due monitor entries.
 * For each due entry with a place_id, queries Google Places API for
 * current state, then records an observation with change detection.
 *
 * Body: { userId: string, limit?: number, dryRun?: boolean }
 *
 * Designed to be called by a Vercel cron or manual trigger.
 * Respects rate limits by capping entries per run (default 10).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadMonitorInventory,
  getDueEntries,
  recordObservation,
} from '../../../_lib/monitor-inventory';
import type {
  MonitorEntry,
  ObservedState,
} from '../../../_lib/monitor-inventory';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PLACES_SERVER_KEY = process.env.GOOGLE_PLACES_SERVER_KEY;

const DEFAULT_LIMIT = 10;

// Fields to request from Places API (New)
const PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.currentOpeningHours',
  'places.priceLevel',
  'places.editorialSummary',
  'places.websiteUri',
].join(',');

// ---- Google Places fetch ----

interface PlaceData {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  priceLevel?: string;
  editorialSummary?: { text?: string };
}

async function fetchPlaceDetails(placeId: string): Promise<PlaceData | null> {
  if (!PLACES_SERVER_KEY) return null;

  try {
    const url = `https://places.googleapis.com/v1/places/${placeId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': PLACES_SERVER_KEY,
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,businessStatus,priceLevel,editorialSummary',
      },
    });
    if (!res.ok) {
      console.error(`Places API error for ${placeId}: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`Places API fetch failed for ${placeId}:`, err);
    return null;
  }
}

// ---- Map price level strings to numeric ----

function priceLevelToNumber(level?: string): number | undefined {
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

// ---- Map operational status ----

function mapBusinessStatus(status?: string): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    OPERATIONAL: 'OPERATIONAL',
    CLOSED_TEMPORARILY: 'CLOSED_TEMPORARILY',
    CLOSED_PERMANENTLY: 'CLOSED_PERMANENTLY',
  };
  return map[status] ?? status;
}

// ---- Build observed state from Places data ----

function buildObservedState(data: PlaceData): ObservedState {
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

// ---- Cadence computation (mirrors discovery-monitoring.ts) ----

function cadenceIntervalMs(monitorType: string, monitorStatus: string): number {
  // Priority entries check more frequently
  const isPriority = monitorStatus === 'priority';

  // Type-based cadence defaults
  const cadenceMap: Record<string, number> = {
    'dining': 7 * 24 * 60 * 60 * 1000,          // weekly
    'nightlife': 7 * 24 * 60 * 60 * 1000,        // weekly
    'accommodation': 14 * 24 * 60 * 60 * 1000,   // bi-weekly
    'cultural': 14 * 24 * 60 * 60 * 1000,        // bi-weekly
    'experience': 14 * 24 * 60 * 60 * 1000,      // bi-weekly
    'general': 14 * 24 * 60 * 60 * 1000,         // bi-weekly
  };

  const base = cadenceMap[monitorType] ?? cadenceMap.general ?? 14 * 24 * 60 * 60 * 1000;
  return isPriority ? Math.floor(base * 0.5) : base;
}

function computeNextCheckAt(entry: MonitorEntry, observedAt: string): string {
  const intervalMs = cadenceIntervalMs(entry.monitorType, entry.monitorStatus);
  const baseMs = new Date(observedAt).getTime();
  return new Date(baseMs + intervalMs).toISOString();
}

// ---- GET: status check (how many due?) ----

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }
  const inventory = await loadMonitorInventory(userId);
  const due = getDueEntries(inventory);
  return NextResponse.json({
    totalEntries: inventory.entries.length,
    dueCount: due.length,
    dueEntries: due.map(e => ({ id: e.id, name: e.name, city: e.city, type: e.monitorType, lastObservedAt: e.lastObservedAt })),
    updatedAt: inventory.updatedAt,
  });
}

// ---- POST: run observations ----

interface RunResult {
  entryId: string;
  name: string;
  status: 'observed' | 'skipped-no-place-id' | 'skipped-fetch-failed';
  changes?: string[];
  nextCheckAt?: string;
}

export async function POST(request: NextRequest) {
  let body: { userId?: string; limit?: number; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { userId, limit = DEFAULT_LIMIT, dryRun = false } = body;

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  if (!PLACES_SERVER_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_SERVER_KEY not configured' },
      { status: 501 },
    );
  }

  const inventory = await loadMonitorInventory(userId);
  const due = getDueEntries(inventory);

  // Cap per run to avoid API rate limits
  const batch = due.slice(0, Math.min(limit, 20));

  if (batch.length === 0) {
    return NextResponse.json({
      message: 'No entries due for observation',
      totalEntries: inventory.entries.length,
      dueCount: 0,
      results: [],
    });
  }

  const results: RunResult[] = [];

  for (const entry of batch) {
    // Need a place_id to fetch from Google Places
    if (!entry.place_id) {
      results.push({
        entryId: entry.id,
        name: entry.name,
        status: 'skipped-no-place-id',
      });
      continue;
    }

    const placeData = await fetchPlaceDetails(entry.place_id);
    if (!placeData) {
      results.push({
        entryId: entry.id,
        name: entry.name,
        status: 'skipped-fetch-failed',
      });
      continue;
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
      continue;
    }

    // Record the observation (change detection happens inside recordObservation)
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
    results.push({
      entryId: entry.id,
      name: entry.name,
      status: 'observed',
      changes: latestObs?.changes ?? [],
      nextCheckAt: updated?.nextCheckAt,
    });
  }

  const observed = results.filter(r => r.status === 'observed');
  const withChanges = observed.filter(r => r.changes && r.changes.length > 0);

  return NextResponse.json({
    message: `Observed ${observed.length}/${batch.length} entries${dryRun ? ' (dry run)' : ''}`,
    totalEntries: inventory.entries.length,
    dueCount: due.length,
    batchSize: batch.length,
    results,
    summary: {
      observed: observed.length,
      skipped: results.length - observed.length,
      withChanges: withChanges.length,
    },
  });
}
