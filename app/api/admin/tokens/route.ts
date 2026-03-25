import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { COOKIE_NAME, loadUsers } from '../../../_lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min cache

const AGENTS_DIR = path.join(process.env.HOME || '/root', '.openclaw', 'agents');

interface UsageEntry {
  ts: number;
  agent: string;
  total: number;
}

function collectUsage(): UsageEntry[] {
  const entries: UsageEntry[] = [];
  const now = Date.now();
  const h24Ago = now - 24 * 3600000;

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }

  for (const agentName of agentDirs) {
    const sessionsDir = path.join(AGENTS_DIR, agentName, 'sessions');
    if (!existsSync(sessionsDir)) continue;

    let files: string[];
    try {
      files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(path.join(sessionsDir, file), 'utf8');
      } catch {
        continue;
      }

      for (const line of content.split('\n')) {
        if (!line.trim() || !line.includes('"usage"')) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'message') continue;
          const msg = d.message;
          if (!msg || msg.role !== 'assistant' || !msg.usage) continue;

          const ts = new Date(d.timestamp).getTime();
          if (ts < h24Ago || isNaN(ts)) continue;

          entries.push({
            ts,
            agent: agentName,
            total:
              msg.usage.totalTokens ||
              msg.usage.total_tokens ||
              (msg.usage.input || 0) + (msg.usage.output || 0),
          });
        } catch {
          continue;
        }
      }
    }
  }

  return entries.sort((a, b) => a.ts - b.ts);
}

export async function GET() {
  // Owner-only
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const users = loadUsers();
  const user = users.users[userId];
  if (!user?.isOwner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const now = Date.now();
  const h2Ago = now - 2 * 3600000;
  const entries = collectUsage();
  const total24h = entries.reduce((s, e) => s + e.total, 0);

  // Hourly buckets (24h)
  const hourly: Array<{ hour: string; tokens: number }> = [];
  for (let h = 0; h < 24; h++) {
    const start = now - (24 - h) * 3600000;
    const end = start + 3600000;
    const tokens = entries
      .filter(e => e.ts >= start && e.ts < end)
      .reduce((s, e) => s + e.total, 0);
    const d = new Date(start);
    const hourNum = parseInt(d.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
    const timeLabel = d.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: true });
    // Show day prefix at midnight (hour 0) or first hour of the window
    const isNewDay = hourNum === 0 || h === 0;
    const dayLabel = isNewDay
      ? d.toLocaleString('en-US', { timeZone: 'America/Toronto', weekday: 'short' }) + ' '
      : '';
    const label = dayLabel + timeLabel;
    hourly.push({ hour: label, tokens });
  }

  // 5-min buckets (2h)
  const fiveMin: Array<{ time: string; tokens: number; topAgent: string }> = [];
  for (let m = 0; m < 24; m++) {
    const start = h2Ago + m * 300000;
    if (start > now) break;
    const end = start + 300000;
    const bucket = entries.filter(e => e.ts >= start && e.ts < end);
    const tokens = bucket.reduce((s, e) => s + e.total, 0);
    const agentMap: Record<string, number> = {};
    for (const e of bucket) agentMap[e.agent] = (agentMap[e.agent] || 0) + e.total;
    const topAgent = Object.entries(agentMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const label = new Date(start).toLocaleString('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    fiveMin.push({ time: label, tokens, topAgent });
  }

  // Agent totals
  const agentMap: Record<string, number> = {};
  for (const e of entries) agentMap[e.agent] = (agentMap[e.agent] || 0) + e.total;
  const agents = Object.entries(agentMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, tokens]) => ({
      name,
      tokens,
      pct: total24h > 0 ? Math.round((tokens / total24h) * 100) : 0,
    }));

  return NextResponse.json({ total24h, hourly, fiveMin, agents });
}
