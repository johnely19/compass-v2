import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const ROLE_MAP: Record<string, string> = {
  main: 'Orchestrator',
  charlie: 'General Assistant',
  disco: 'Discovery & Research',
  concierge: 'Travel Concierge',
  'test-concierge': 'QA & Testing',
  devclaw: 'Development Orchestration',
  builder: 'Code & Infrastructure',
};

function homeDir(): string {
  return process.env.HOME || '/Users/john';
}

function safeReadJSON(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

interface SessionEntry {
  updatedAt: number;
  totalTokens?: number;
  contextTokens?: number;
  model?: string;
  status?: string;
  startedAt?: number;
  [key: string]: unknown;
}

function loadAgents() {
  const agentsDir = path.join(homeDir(), '.openclaw', 'agents');
  if (!existsSync(agentsDir)) return [];

  const now = Date.now();
  const HOUR = 3600000;
  const agents: Array<{
    id: string; role: string; status: 'active' | 'idle' | 'dormant';
    lastActivity: number; model: string; sessionCount: number;
    totalTokens: number; contextTokens: number;
  }> = [];

  for (const agentId of readdirSync(agentsDir)) {
    if (agentId.startsWith('.')) continue;
    const sessionsPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessionsData = safeReadJSON(sessionsPath) as Record<string, SessionEntry> | null;
    if (!sessionsData) continue;

    const sessions = Object.values(sessionsData);
    if (sessions.length === 0) continue;

    // Find most recent session for status
    let latestTimestamp = 0;
    let mainSessionTokens = 0;
    let contextTokensLatest = 200000; // default context window
    let model = 'claude-opus-4-6';

    for (const [key, session] of Object.entries(sessionsData)) {
      if (session.updatedAt > latestTimestamp) {
        latestTimestamp = session.updatedAt;
      }

      // Use main Discord channel session for context pressure (not cron/subagent)
      const isMainSession = key.includes(':discord:channel:') &&
        !key.includes(':cron:') && !key.includes(':run:') && !key.includes(':subagent:');

      if (isMainSession && typeof session.totalTokens === 'number') {
        mainSessionTokens = session.totalTokens;
      }
      if (isMainSession && typeof session.contextTokens === 'number') {
        contextTokensLatest = session.contextTokens;
      }

      // Extract model
      if (session.model && typeof session.model === 'string') {
        model = session.model.replace(/^(anthropic|openai|google)\//, '');
      }
    }

    if (latestTimestamp === 0) continue;

    const hoursSince = (now - latestTimestamp) / HOUR;
    const status: 'active' | 'idle' | 'dormant' =
      hoursSince < 1 ? 'active' : hoursSince < 6 ? 'idle' : 'dormant';

    // Count sessions updated in last 24h, excluding cron run artifacts
    const activeSessions = Object.entries(sessionsData).filter(([key, s]) => {
      if (now - s.updatedAt > 24 * HOUR) return false;
      // Exclude short-lived cron/subagent runs
      if (key.includes(':cron:') || key.includes(':run:')) return false;
      return true;
    }).length;

    agents.push({
      id: agentId,
      role: ROLE_MAP[agentId] || agentId,
      status,
      lastActivity: latestTimestamp,
      model,
      sessionCount: activeSessions,
      totalTokens: mainSessionTokens,
      contextTokens: contextTokensLatest,
    });
  }

  return agents;
}

function loadStats() {
  const dataDir = path.join(process.cwd(), 'data');

  let placeCards = 0;
  const pcIndex = path.join(dataDir, 'placecards', 'index.json');
  const pcData = safeReadJSON(pcIndex) as Record<string, unknown> | null;
  if (pcData) placeCards = Object.keys(pcData).length;

  let cottages = 0;
  const cData = safeReadJSON(path.join(dataDir, 'cottages', 'index.json')) as { cottages?: unknown[] } | null;
  if (cData?.cottages) cottages = cData.cottages.length;

  let activeContexts = 0;
  const manifest = safeReadJSON(path.join(dataDir, 'compass-manifest.json')) as { contexts?: Array<{ active?: boolean }> } | null;
  if (manifest?.contexts) {
    activeContexts = manifest.contexts.filter(c => c.active !== false).length;
  }

  return { placeCards, cottages, activeContexts };
}

function loadWorkers(): Array<{
  sessionKey: string; status: string; model: string;
  totalTokens: number; startedAt: number;
}> {
  const agentsDir = path.join(homeDir(), '.openclaw', 'agents');
  if (!existsSync(agentsDir)) return [];

  const now = Date.now();
  const HOUR = 3600000;
  const workers: Array<{
    sessionKey: string; status: string; model: string;
    totalTokens: number; startedAt: number;
  }> = [];

  // Scan all agent directories for subagent sessions
  for (const agentId of readdirSync(agentsDir)) {
    if (agentId.startsWith('.')) continue;
    const sessionsPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    const sessionsData = safeReadJSON(sessionsPath) as Record<string, SessionEntry> | null;
    if (!sessionsData) continue;

    for (const [key, session] of Object.entries(sessionsData)) {
      // Match subagent sessions: agent:main:subagent:*
      if (!key.includes(':subagent:')) continue;

      // Only include workers from last 24h
      if (now - session.updatedAt > 24 * HOUR) continue;

      workers.push({
        sessionKey: key,
        status: session.status || 'unknown',
        model: session.model?.replace(/^(anthropic|openai|google)\//, '') || '—',
        totalTokens: session.totalTokens || 0,
        startedAt: session.startedAt || session.updatedAt,
      });
    }
  }

  // Sort: running first, then by most recent
  workers.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return b.startedAt - a.startedAt;
  });

  return workers.slice(0, 10);
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const agents = loadAgents();
  const stats = loadStats();
  const workers = loadWorkers();
  const totalTokens24h = agents.reduce((sum, a) => sum + a.totalTokens, 0);

  return NextResponse.json({
    agents,
    stats: {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'active').length,
      placeCards: stats.placeCards,
      cottages: stats.cottages,
      activeContexts: stats.activeContexts,
      totalTokens24h,
    },
    workers,
  });
}
