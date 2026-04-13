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
 * Budget: 60s per user batch, 15 entries per user per run for better backlog drain.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers } from '../../../_lib/user';
import { loadMonitorInventory, getDueEntries } from '../../../_lib/monitor-inventory';
import { runObservations, MAX_CONCURRENT_PLACES, MAX_WEB_ENRICHMENTS_PER_RUN } from '../../../_lib/observation-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

// Entries per user per cron run (increased from 5 for better backlog drain)
const ENTRIES_PER_USER = 15;

// ---- Auth ----

function isAuthorized(request: NextRequest): boolean {
  // In development, allow without auth
  if (process.env.NODE_ENV === 'development') return true;
  if (!CRON_SECRET) return false;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${CRON_SECRET}`;
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

    if (batch.length === 0) return summary;

    // Run observations with bounded concurrency and web enrichment gating
    const result = await runObservations({
      userId,
      entries: batch,
      maxConcurrent: MAX_CONCURRENT_PLACES,
      maxWebEnrichments: MAX_WEB_ENRICHMENTS_PER_RUN,
    });

    summary.observed = result.observed;
    summary.skipped = result.skipped;
    summary.withChanges = result.withChanges;

    // Count critical changes
    for (const r of result.results) {
      if (r.significanceLevel === 'critical') {
        summary.criticalChanges++;
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