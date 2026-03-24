import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

interface AgentHealth {
  id: string;
  role: string;
  status: 'active' | 'idle' | 'dormant';
  lastActivity: number;
  model: string;
  sessionCount: number;
  totalTokens: number;
  contextTokens: number;
}

interface AgentHealthStats {
  totalAgents: number;
  activeAgents: number;
  placeCards: number;
  cottages: number;
  activeTrips: number;
  totalTokens24h: number;
}

function getAgentsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agents');
}

function getStatus(lastMs: number): 'active' | 'idle' | 'dormant' {
  const diff = Date.now() - lastMs;
  if (diff < 3600000) return 'active';
  if (diff < 86400000) return 'idle';
  return 'dormant';
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const agentsDir = getAgentsDir();
    const agentDirs = readdirSync(agentsDir).filter(name => {
      if (name.startsWith('.')) return false;
      try {
        return readdirSync(path.join(agentsDir, name)).includes('sessions');
      } catch { return false; }
    });

    const agents: AgentHealth[] = [];
    const h24Ago = Date.now() - 86400000;

    for (const agentName of agentDirs) {
      try {
        const sessionsPath = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
        const sessionsData = JSON.parse(readFileSync(sessionsPath, 'utf8'));

        let latestMs = 0;
        let model = 'unknown';
        let sessionCount = 0;
        let totalTokens = 0;
        let contextTokens = 0;

        for (const [, session] of Object.entries(sessionsData)) {
          const s = session as Record<string, unknown>;
          const updAt = s.updatedAt as number | undefined;
          if (updAt && updAt > latestMs) latestMs = updAt;

          // Count sessions active in last 24h
          if (updAt && updAt > h24Ago) sessionCount++;

          // Extract model from session config
          const config = s.config as Record<string, unknown> | undefined;
          if (config?.model && typeof config.model === 'string') {
            model = config.model;
          }
          // Also check runtime metadata
          const meta = s.meta as Record<string, unknown> | undefined;
          if (meta?.model && typeof meta.model === 'string') {
            model = meta.model;
          }
          // Check skillsSnapshot for model
          const snap = s.skillsSnapshot as Record<string, unknown> | undefined;
          if (snap?.prompt && typeof snap.prompt === 'string') {
            const modelMatch = snap.prompt.match(/model=([^\s|]+)/);
            if (modelMatch?.[1]) model = modelMatch[1];
          }

          // Token counts from usage
          const usage = s.usage as Record<string, number> | undefined;
          if (usage) {
            totalTokens += (usage.totalTokens || usage.total_tokens || 0);
            contextTokens = Math.max(contextTokens, usage.contextTokens || usage.context_tokens || 200000);
          }
        }

        // Default context window if not found
        if (contextTokens === 0) contextTokens = 200000;

        agents.push({
          id: agentName,
          role: '',
          status: latestMs > 0 ? getStatus(latestMs) : 'dormant',
          lastActivity: latestMs || 0,
          model: model.replace(/^(anthropic|openai|google)\//, ''),
          sessionCount,
          totalTokens,
          contextTokens,
        });
      } catch { /* skip */ }
    }

    // Compute stats
    const activeCount = agents.filter(a => a.status === 'active').length;

    let placeCards = 0;
    const pcDir = path.join(process.cwd(), 'data', 'placecards');
    try {
      const indexPath = path.join(pcDir, 'index.json');
      if (existsSync(indexPath)) {
        placeCards = Object.keys(JSON.parse(readFileSync(indexPath, 'utf8'))).length;
      }
    } catch { /* ignore */ }

    let cottages = 0;
    try {
      const cPath = path.join(process.cwd(), 'data', 'cottages', 'index.json');
      if (existsSync(cPath)) {
        cottages = (JSON.parse(readFileSync(cPath, 'utf8')).cottages || []).length;
      }
    } catch { /* ignore */ }

    let activeTrips = 0;
    try {
      const mPath = path.join(process.cwd(), 'data', 'compass-manifest.json');
      if (existsSync(mPath)) {
        const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
        activeTrips = (manifest.contexts || []).filter((c: { type: string; active: boolean }) => c.type === 'trip' && c.active).length;
      }
    } catch { /* ignore */ }

    // Token sum from /api/admin/tokens data (approximate from agent data)
    const totalTokens24h = agents.reduce((sum, a) => sum + a.totalTokens, 0);

    const stats: AgentHealthStats = {
      totalAgents: agents.length,
      activeAgents: activeCount,
      placeCards,
      cottages,
      activeTrips,
      totalTokens24h,
    };

    return NextResponse.json({ agents, stats });
  } catch {
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}
