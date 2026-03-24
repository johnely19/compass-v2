import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

interface AgentInfo {
  name: string;
  status: 'active' | 'idle' | 'dormant';
  lastActivity: string | null;
  model: string | null;
  tokenUsage: {
    input: number;
    output: number;
  } | null;
}

function getAgentSessionsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agents');
}

function getAgentStatus(lastActivityMs: number | null): 'active' | 'idle' | 'dormant' {
  if (!lastActivityMs) return 'dormant';
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  if (now - lastActivityMs < hourMs) return 'active';
  if (now - lastActivityMs < 24 * hourMs) return 'idle';
  return 'dormant';
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const agentsDir = getAgentSessionsDir();
    const agentDirs = readdirSync(agentsDir).filter((name) => {
      if (name.startsWith('.')) return false;
      try {
        const contents = readdirSync(path.join(agentsDir, name));
        return contents.includes('sessions');
      } catch { return false; }
    });

    const agents: AgentInfo[] = [];

    for (const agentName of agentDirs) {
      try {
        const sessionsPath = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
        const sessionsData = readFileSync(sessionsPath, 'utf8');
        const sessions = JSON.parse(sessionsData);

        let latestSession: { updatedAt?: number; label?: string } | null = null;
        let model: string | null = null;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        for (const [, session] of Object.entries(sessions)) {
          const s = session as { updatedAt?: number; label?: string; skillsSnapshot?: { prompt?: string } };
          if (!latestSession || (s.updatedAt && s.updatedAt > (latestSession.updatedAt || 0))) {
            latestSession = s;
          }
          if (s.skillsSnapshot?.prompt) {
            const modelMatch = s.skillsSnapshot.prompt.match(/model/i);
            if (modelMatch) {
              model = 'claude';
            }
          }
        }

        const status = getAgentStatus(latestSession?.updatedAt ?? null);

        agents.push({
          name: agentName,
          status,
          lastActivity: latestSession?.updatedAt
            ? new Date(latestSession.updatedAt).toISOString()
            : null,
          model,
          tokenUsage: totalInputTokens || totalOutputTokens
            ? { input: totalInputTokens, output: totalOutputTokens }
            : null,
        });
      } catch {
        // Skip agents with invalid sessions
      }
    }

    return NextResponse.json({ agents });
  } catch {
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}
