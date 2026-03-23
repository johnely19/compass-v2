/* ============================================================
   Admin API — Cron Jobs
   Reads from ~/.openclaw/cron/jobs.json
   ============================================================ */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: string;
    expr?: string;
    at?: string;
    tz?: string;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    lastError?: string;
  };
}

interface CronJobsResponse {
  jobs: Array<{
    id: string;
    name: string;
    enabled: boolean;
    schedule: string;
    lastRun: string | null;
    status: 'healthy' | 'missed' | 'error';
    lastError: string | null;
  }>;
}

function getCronJobsPath(): string {
  return path.join(os.homedir(), '.openclaw', 'cron', 'jobs.json');
}

function getJobStatus(lastRunStatus?: string, lastStatus?: string): 'healthy' | 'missed' | 'error' {
  if (lastStatus === 'error' || lastRunStatus === 'error') return 'error';
  if (!lastRunStatus && !lastStatus) return 'healthy';
  // Check if last run was more than 2x the expected interval ago
  // For now, just check if there was an error status
  return 'healthy';
}

function formatSchedule(schedule: CronJob['schedule']): string {
  if (schedule.kind === 'cron' && schedule.expr) {
    return `${schedule.expr} (${schedule.tz || 'UTC'})`;
  }
  if (schedule.kind === 'at' && schedule.at) {
    return new Date(schedule.at).toLocaleString();
  }
  return schedule.kind;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const jobsPath = getCronJobsPath();
    const jobsData = readFileSync(jobsPath, 'utf8');
    const jobsJson = JSON.parse(jobsData);

    const jobs: CronJobsResponse['jobs'] = (jobsJson.jobs || []).map((job: CronJob) => ({
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      schedule: formatSchedule(job.schedule),
      lastRun: job.state?.lastRunAtMs
        ? new Date(job.state.lastRunAtMs).toISOString()
        : null,
      status: getJobStatus(job.state?.lastRunStatus, job.state?.lastStatus),
      lastError: job.state?.lastError || null,
    }));

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load cron jobs' }, { status: 500 });
  }
}
