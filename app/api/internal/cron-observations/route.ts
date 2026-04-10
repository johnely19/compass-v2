/**
 * GET /api/internal/cron-observations
 *
 * Vercel Cron entrypoint for scheduled monitoring observation runs.
 * Iterates all registered users and fires observation runs for each.
 *
 * Secured by CRON_SECRET (Vercel sets Authorization: Bearer <secret>).
 * Gracefully skips users with no due entries.
 *
 * Schedule: twice daily (see vercel.json)
 * Budget: 30s per user batch, 5 entries per user per run to stay within limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers } from '../../../_lib/user';
import { loadMonitorInventory, getDueEntries, recordObservation } from '../../../_lib/monitor-inventory';
import { runWebEnrichment } from '../../../_lib/web-search-enrichment';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const PLACES_SERVER_KEY = process.env.GOOGLE_PLACES_SERVER_KEY;

// Entries per user per cron run (conservative quota management)
const ENTRIES_PER_USER = 5;

// ---- Auth ----

function isAuthorized(request: NextRequest): boolean {
  // In development, allow without auth
  if (process.env.NODE_ENV === 'development') return true;
  if (!CRON_SECRET) return false;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${CRON_SECRET}`;
}

// ---- Places fetch (inline — same logic as run-observations) ----

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
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          'X-Goog-Api-Key': PLACES_SERVER_KEY,
          'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,businessStatus,priceLevel,editorialSummary',
        },
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

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

// ---- Cadence (mirrors run-observations) ----

const DAY_MS = 24 * 60 * 60 * 1000;

import type { MonitorEntry } from '../../../_lib/monitor-inventory';

function computeNextCheckAt(entry: MonitorEntry, observedAt: string): string {
  const cadenceMap: Record<string, number> = {
    hospitality: 7 * DAY_MS,
    stay: 14 * DAY_MS,
    development: 14 * DAY_MS,
    culture: 14 * DAY_MS,
    general: 14 * DAY_MS,
  };
  const base = cadenceMap[entry.monitorType] ?? 14 * DAY_MS;
  const latestLevel = entry.observations?.[0]?.significanceLevel;
  let intervalMs: number;
  if (latestLevel === 'critical') {
    intervalMs = 2 * DAY_MS;
  } else if (latestLevel === 'notable') {
    intervalMs = 5 * DAY_MS;
  } else {
    intervalMs = entry.monitorStatus === 'priority' ? Math.floor(base * 0.5) : base;
  }
  return new Date(new Date(observedAt).getTime() + intervalMs).toISOString();
}

// ---- Per-user observation run ----

interface UserRunSummary {
  userId: string;
  totalEntries: number;
  dueCount: number;
  observed: number;
  skipped: number;
  withChanges: number;
  criticalChanges: number;
  error?: string;
}

async function runForUser(userId: string): Promise<UserRunSummary> {
  const summary: UserRunSummary = {
    userId,
    totalEntries: 0,
    dueCount: 0,
    observed: 0,
    skipped: 0,
    withChanges: 0,
    criticalChanges: 0,
  };

  try {
    const inventory = await loadMonitorInventory(userId);
    summary.totalEntries = inventory.entries.length;

    if (inventory.entries.length === 0) return summary;

    const due = getDueEntries(inventory);
    summary.dueCount = due.length;

    const batch = due.slice(0, ENTRIES_PER_USER);

    for (const entry of batch) {
      if (!entry.place_id) {
        summary.skipped++;
        continue;
      }

      const placeData = await fetchPlaceDetails(entry.place_id);
      if (!placeData) {
        summary.skipped++;
        continue;
      }

      const now = new Date().toISOString();
      const observedState = {
        observedAt: now,
        source: 'google-places' as const,
        rating: placeData.rating,
        reviewCount: placeData.userRatingCount,
        description: placeData.editorialSummary?.text,
        operationalStatus: placeData.businessStatus,
        priceLevel: priceLevelToNumber(placeData.priceLevel),
      };

      const nextCheckAt = computeNextCheckAt(entry, now);

      const updated = await recordObservation({
        userId,
        entryId: entry.id,
        observation: {
          observedAt: now,
          source: 'google-places',
          state: observedState,
        },
        nextCheckAt,
      });

      summary.observed++;

      const latestObs = updated?.observations?.[0];
      if (latestObs?.changes && latestObs.changes.length > 0) {
        summary.withChanges++;
        if (latestObs.significanceLevel === 'critical') {
          summary.criticalChanges++;
        }
      }

      // Web enrichment for notable context
      const webEnrichment = await runWebEnrichment({
        name: entry.name,
        city: entry.city,
        monitorType: entry.monitorType,
      });
      if (webEnrichment && webEnrichment.changes.length > 0) {
        const webAt = new Date().toISOString();
        await recordObservation({
          userId,
          entryId: entry.id,
          observation: {
            observedAt: webAt,
            source: 'web-search',
            changes: webEnrichment.changes,
            changeSummary: `Web signals: ${webEnrichment.changes.join(', ')}`,
            state: {
              observedAt: webAt,
              source: 'web-search',
              notes: webEnrichment.notes,
            },
          },
        });
      }
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}

// ---- GET handler ----

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const users = getAllUsers();

  if (users.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No registered users',
      durationMs: Date.now() - startMs,
    });
  }

  const userSummaries: UserRunSummary[] = [];
  let totalObserved = 0;
  let totalCritical = 0;

  // Process users sequentially to respect rate limits
  for (const user of users) {
    const result = await runForUser(user.id);
    userSummaries.push(result);
    totalObserved += result.observed;
    totalCritical += result.criticalChanges;
  }

  const durationMs = Date.now() - startMs;

  console.log(
    `[cron-observations] Done: ${totalObserved} observed across ${users.length} users` +
    (totalCritical > 0 ? ` (${totalCritical} CRITICAL)` : '') +
    ` in ${durationMs}ms`,
  );

  return NextResponse.json({
    ok: true,
    usersProcessed: users.length,
    totalObserved,
    totalCritical,
    durationMs,
    users: userSummaries,
  });
}
