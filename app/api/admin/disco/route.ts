/* ============================================================
   Admin API — Disco Activity Stats (Issue #91)
   Returns Disco operational data: last run, scans today,
   discoveries pushed today, place changes, errors.
   ============================================================ */

import { NextResponse } from 'next/server';
import { getCurrentUser, getAllUsers } from '../../../_lib/user';
import { getUserDiscoveries } from '../../../_lib/user-data';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function homeDir(): string {
  return process.env.HOME || '/Users/john';
}

interface CronJob {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  state?: {
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    consecutiveErrors?: number;
    lastError?: string;
    lastErrorReason?: string;
  };
}

interface RunEntry {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  runAtMs?: number;
  durationMs?: number;
}

/** Disco-related job name patterns */
const DISCO_JOB_PATTERNS = [
  'discovery',
  'disco',
  'delta monitor',
  'source scout',
];

function isDiscoJob(job: CronJob): boolean {
  const name = job.name.toLowerCase();
  return DISCO_JOB_PATTERNS.some(p => name.includes(p));
}

function readRunLog(jobId: string): RunEntry[] {
  const p = path.join(homeDir(), '.openclaw', 'cron', 'runs', `${jobId}.jsonl`);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as RunEntry);
  } catch {
    return [];
  }
}

function isTodayET(tsMs: number): boolean {
  const now = new Date();
  const entryDate = new Date(tsMs);
  // Compare in Eastern time
  const etOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' };
  return (
    new Intl.DateTimeFormat('en-CA', etOpts).format(now) ===
    new Intl.DateTimeFormat('en-CA', etOpts).format(entryDate)
  );
}

/** Count VERIFIED finds in a summary text (common pattern: "VERIFIED finds\n- X\n- Y") */
function countVerifiedInSummary(summary: string): number {
  // Match lines like "- PlaceName" that follow a VERIFIED header
  const verifiedSection = summary.match(/VERIFIED finds?\s*[:\n]([\s\S]*?)(?:Leads pending|Next actions|$)/i);
  if (!verifiedSection || !verifiedSection[1]) return 0;
  const lines = verifiedSection[1].split('\n').filter(l => /^[-•*]\s+\S/.test(l.trim()));
  // Exclude "None this run" lines
  return lines.filter(l => !/none\s+this\s+run/i.test(l)).length;
}

/** Extract place change info from Delta Monitor summaries */
function extractChangesFromSummary(summary: string): { movers: number; closures: number; openings: number } {
  let movers = 0, closures = 0, openings = 0;
  const moverMatch = summary.match(/(\d+)\s+mover/i);
  if (moverMatch?.[1]) movers = parseInt(moverMatch[1]);
  const closureMatch = summary.match(/(\d+)\s+closure/i);
  if (closureMatch?.[1]) closures = parseInt(closureMatch[1]);
  const openingMatch = summary.match(/(\d+)\s+(?:new\s+)?opening/i);
  if (openingMatch?.[1]) openings = parseInt(openingMatch[1]);
  return { movers, closures, openings };
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // --- Load cron jobs ---
  const cronPath = path.join(homeDir(), '.openclaw', 'cron', 'jobs.json');
  let allJobs: CronJob[] = [];
  if (existsSync(cronPath)) {
    try {
      const cronFile = JSON.parse(readFileSync(cronPath, 'utf-8'));
      allJobs = cronFile.jobs || [];
    } catch { /* ignore */ }
  }

  const discoJobs = allJobs.filter(isDiscoJob);

  // --- Find last cron run across all Disco jobs ---
  let lastRunAtMs: number | null = null;
  let lastRunStatus: string | null = null;
  let lastJobName: string | null = null;

  for (const job of discoJobs) {
    const ts = job.state?.lastRunAtMs;
    if (ts && (!lastRunAtMs || ts > lastRunAtMs)) {
      lastRunAtMs = ts;
      lastRunStatus = job.state?.lastRunStatus || job.state?.lastStatus || null;
      lastJobName = job.name;
    }
  }

  // --- Scan today's run logs ---
  let runsToday = 0;
  let errorsToday = 0;
  let placesScannedToday = 0;
  let changesDetectedToday = 0;
  const errorDetails: string[] = [];

  for (const job of discoJobs) {
    const runs = readRunLog(job.id);
    const todayRuns = runs.filter(r => r.ts && isTodayET(r.ts));

    runsToday += todayRuns.length;

    for (const run of todayRuns) {
      if (run.status === 'error' || run.status === 'timeout') {
        errorsToday++;
        const errMsg = `${job.name}: ${run.status}`;
        if (!errorDetails.includes(errMsg)) errorDetails.push(errMsg);
      }

      if (run.summary) {
        // Count verified discoveries from discovery jobs
        const isDiscoveryJob = job.name.toLowerCase().includes('discovery') ||
          job.name.toLowerCase().includes('source scout');
        if (isDiscoveryJob) {
          placesScannedToday += countVerifiedInSummary(run.summary);
        }
        // Count changes from delta monitor
        if (job.name.toLowerCase().includes('delta monitor') || job.name.toLowerCase().includes('disco places')) {
          const { movers, closures, openings } = extractChangesFromSummary(run.summary);
          changesDetectedToday += movers + closures + openings;
        }
      }
    }
  }

  // --- Count discoveries pushed today (from user Blob) ---
  let discoveriesToday = 0;
  try {
    const users = getAllUsers();
    const allDiscoveries = await Promise.all(users.map(u => getUserDiscoveries(u.id)));
    for (const ud of allDiscoveries) {
      if (!ud?.discoveries) continue;
      for (const d of ud.discoveries) {
        if (d.discoveredAt && isTodayET(new Date(d.discoveredAt).getTime())) {
          discoveriesToday++;
        }
      }
    }
  } catch { /* Blob unavailable in dev */ }

  // --- Build job summary for UI ---
  const jobSummary = discoJobs.map(job => ({
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    lastRun: job.state?.lastRunAtMs || null,
    lastStatus: job.state?.lastRunStatus || job.state?.lastStatus || null,
    consecutiveErrors: job.state?.consecutiveErrors || 0,
    lastError: job.state?.lastError || null,
  }));

  return NextResponse.json({
    lastRunAtMs,
    lastRunStatus,
    lastJobName,
    runsToday,
    placesScannedToday,
    discoveriesToday,
    changesDetectedToday,
    errorsToday,
    errorDetails,
    jobs: jobSummary,
  });
}
