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
} from '../../../_lib/monitor-inventory';
import {
  runObservations,
  MAX_CONCURRENT_PLACES,
  MAX_WEB_ENRICHMENTS_PER_RUN,
} from '../../../_lib/observation-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PLACES_SERVER_KEY = process.env.GOOGLE_PLACES_SERVER_KEY;

const DEFAULT_LIMIT = 10;

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

  // Run observations with bounded concurrency and web enrichment gating
  const summary = await runObservations({
    userId,
    entries: batch,
    maxConcurrent: MAX_CONCURRENT_PLACES,
    maxWebEnrichments: MAX_WEB_ENRICHMENTS_PER_RUN,
    dryRun,
  });

  return NextResponse.json({
    message: `Observed ${summary.observed}/${batch.length} entries${dryRun ? ' (dry run)' : ''}`,
    totalEntries: inventory.entries.length,
    dueCount: due.length,
    batchSize: batch.length,
    results: summary.results,
    summary: {
      observed: summary.observed,
      skipped: summary.skipped,
      withChanges: summary.withChanges,
      withWebSignals: summary.withWebSignals,
    },
  });
}