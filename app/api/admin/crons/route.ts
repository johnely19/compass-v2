import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface CronJob {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; tz?: string; at?: string; every?: string; everyMs?: number };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastError?: string;
  };
}

function homeDir(): string {
  return process.env.HOME || '/Users/john';
}

function humanizeCron(expr: string): string {
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes
  if (min?.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} min`;

  // Every hour at :MM
  if (hour === '*' && min && !min.includes('/') && !min.includes(',')) return `Hourly at :${min.padStart(2, '0')}`;

  // Daily at HH:MM
  if (dom === '*' && mon === '*' && dow === '*' && hour !== '*') {
    const h = parseInt(hour ?? '0');
    const m = parseInt(min ?? '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // Weekly
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
    const h = parseInt(hour ?? '0');
    const m = parseInt(min ?? '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${days[dow ?? ''] || dow} ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return expr;
}

function formatSchedule(schedule: CronJob['schedule']): string {
  if (schedule.kind === 'cron' && schedule.expr) {
    return humanizeCron(schedule.expr);
  }
  if (schedule.kind === 'at' && schedule.at) {
    return `Once: ${new Date(schedule.at).toLocaleString('en-US', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs || parseInt(schedule.every || '0');
    if (ms >= 3600000) return `Every ${Math.round(ms / 3600000)}h`;
    if (ms >= 60000) return `Every ${Math.round(ms / 60000)} min`;
    return `Every ${ms}ms`;
  }
  return schedule.kind;
}

function getHealth(job: CronJob): 'healthy' | 'warning' | 'error' | 'unknown' {
  if (!job.state) return 'unknown';
  if ((job.state.consecutiveErrors ?? 0) > 0) return 'error';
  if (job.state.lastRunStatus === 'error' || job.state.lastStatus === 'error') return 'error';
  if (job.state.nextRunAtMs && job.state.nextRunAtMs < Date.now() - 300000) return 'warning';
  if (job.state.lastRunStatus === 'ok' || job.state.lastStatus === 'ok') return 'healthy';
  return 'unknown';
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cronPath = path.join(homeDir(), '.openclaw', 'cron', 'jobs.json');
  if (!existsSync(cronPath)) {
    return NextResponse.json({ jobs: [] });
  }

  let cronFile: { jobs: CronJob[] };
  try {
    cronFile = JSON.parse(readFileSync(cronPath, 'utf-8'));
  } catch {
    return NextResponse.json({ jobs: [] });
  }

  const jobs = cronFile.jobs.map(job => ({
    id: job.id,
    name: job.name,
    agentId: job.agentId || 'unknown',
    enabled: job.enabled,
    schedule: formatSchedule(job.schedule),
    health: getHealth(job),
    lastRun: job.state?.lastRunAtMs || null,
    lastStatus: job.state?.lastRunStatus || job.state?.lastStatus || null,
    lastDuration: job.state?.lastDurationMs || null,
    nextRun: job.state?.nextRunAtMs || null,
    consecutiveErrors: job.state?.consecutiveErrors || 0,
    lastError: job.state?.lastError || null,
  }));

  return NextResponse.json({ jobs });
}
