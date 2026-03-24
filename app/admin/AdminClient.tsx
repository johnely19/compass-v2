'use client';

import { useState, useEffect, useCallback } from 'react';

/* ---- Types ---- */

interface AgentInfo {
  name: string;
  status: 'active' | 'idle' | 'dormant';
  lastActivity: string | null;
  model: string | null;
  tokenUsage: { input: number; output: number } | null;
  sessionCount?: number;
  totalTokens?: number;
  contextTokens?: number;
}

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastRun: string | null;
  status: 'healthy' | 'missed' | 'error';
  lastError: string | null;
  agentId?: string;
  nextRun?: string | null;
  lastDuration?: number | null;
  consecutiveErrors?: number;
}

interface TokenData {
  total24h: number;
  hourly: Array<{ hour: string; tokens: number }>;
  fiveMin: Array<{ time: string; tokens: number; topAgent: string }>;
  agents: Array<{ name: string; tokens: number; pct: number }>;
}

interface UserWithData {
  id: string;
  name: string;
  code: string;
  city: string;
  isOwner: boolean;
  createdAt: string;
  preferences: {
    interests?: string[];
    cuisines?: string[];
    vibes?: string[];
    avoidances?: string[];
  } | null;
  manifest: {
    contexts: Array<{
      key: string;
      label: string;
      type: string;
      city?: string;
      dates?: string;
      focus: string[];
      active: boolean;
    }>;
  } | null;
  discoveries: {
    discoveries: Array<{
      id: string;
      name: string;
      type: string;
      city: string;
      contextKey: string;
    }>;
  } | null;
}

/* ---- Helpers ---- */

function formatRelativeTime(ts: string | number | null): string {
  if (!ts) return '—';
  const timestamp = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (isNaN(timestamp)) return '—';
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    const mins = Math.floor(-diff / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `in ${mins}m`;
    return `in ${Math.floor(mins / 60)}h`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m ago';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function shortModel(model: string | null): string {
  if (!model) return '—';
  return model.replace(/^(anthropic|openai|google)\//, '');
}

const AGENT_NAMES: Record<string, string> = { main: 'Charlie', devclaw: 'DevClaw', disco: 'Disco' };
const AGENT_ROLES: Record<string, string> = { main: 'Orchestrator', devclaw: 'Development', disco: 'Discovery & Research' };
const AGENT_ORDER: Record<string, number> = { main: 0, devclaw: 1, disco: 2 };

/* ---- Collapsible Section ---- */

function Section({ title, emoji, defaultOpen = true, count, children }: {
  title: string; emoji: string; defaultOpen?: boolean; count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="admin-v2-section">
      <div className="admin-v2-section-header" onClick={() => setOpen(!open)}>
        <h2><span>{emoji}</span> {title}{count != null ? ` (${count})` : ''}</h2>
        <span className={`admin-v2-section-toggle ${open ? 'open' : ''}`}>▸</span>
      </div>
      {open && <div className="admin-v2-section-content">{children}</div>}
    </div>
  );
}

/* ---- Main Component ---- */

export default function AdminClient() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [users, setUsers] = useState<UserWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [agentsRes, cronsRes, tokensRes, usersRes] = await Promise.all([
        fetch('/api/admin/agents'),
        fetch('/api/admin/crons'),
        fetch('/api/admin/tokens'),
        fetch('/api/admin/users'),
      ]);
      if (agentsRes.ok) setAgents((await agentsRes.json()).agents || []);
      if (cronsRes.ok) setCrons((await cronsRes.json()).jobs || []);
      if (tokensRes.ok) setTokenData(await tokensRes.json());
      if (usersRes.ok) setUsers((await usersRes.json()).users || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <main className="page" style={{ maxWidth: 900 }}>
        <div className="page-header"><h1>Admin</h1></div>
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  const sortedAgents = [...agents].sort((a, b) =>
    (AGENT_ORDER[a.name] ?? 99) - (AGENT_ORDER[b.name] ?? 99)
  );
  const coreAgents = sortedAgents.filter(a => ['main', 'devclaw', 'disco'].includes(a.name));
  const activeCount = agents.filter(a => a.status === 'active').length;
  const enabledCrons = crons.filter(j => j.enabled !== false);
  const healthIcon = (s: string) => s === 'healthy' ? '🟢' : s === 'missed' || s === 'warning' ? '🟡' : s === 'error' ? '🔴' : '⚪';

  const maxHourly = tokenData ? Math.max(...tokenData.hourly.map(h => h.tokens), 1) : 1;

  return (
    <main className="page" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h1>Admin</h1>
        <p className="text-muted">{agents.length} agents · {enabledCrons.length} cron jobs · {formatTokens(tokenData?.total24h ?? 0)} tokens (24h)</p>
      </div>

      {/* ---- Agent Health ---- */}
      <Section title="Agent Health" emoji="🤖" count={activeCount}>
        <div className="health-grid">
          {(coreAgents.length > 0 ? coreAgents : sortedAgents).map(agent => {
            const pressure = agent.contextTokens && agent.contextTokens > 0
              ? ((agent.totalTokens ?? 0) / agent.contextTokens) * 100 : 0;
            return (
              <div key={agent.name} className="health-card">
                <div className="health-card-header">
                  <div>
                    <div className="health-agent-name">{AGENT_NAMES[agent.name] || agent.name}</div>
                    <div className="health-agent-role">{AGENT_ROLES[agent.name] || ''}</div>
                  </div>
                  <span className={`health-status-badge health-status-${agent.status}`}>
                    {agent.status}
                  </span>
                </div>
                <div className="health-card-meta">
                  <span className="health-model">{shortModel(agent.model)}</span>
                  <span style={{ marginLeft: 'auto' }}>{formatRelativeTime(agent.lastActivity)}</span>
                </div>
                {pressure > 0 && (
                  <div className="health-pressure-bar">
                    <div className="health-pressure-label">
                      <span>Context</span>
                      <span>{Math.round(pressure)}%</span>
                    </div>
                    <div className="health-pressure-track">
                      <div className="health-pressure-fill" style={{
                        width: `${Math.min(pressure, 100)}%`,
                        background: pressure > 80 ? '#f44336' : pressure > 50 ? '#FF9800' : '#4CAF50',
                      }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Cron Jobs ---- */}
      <Section title="Cron Jobs" emoji="⏰" count={enabledCrons.length}>
        <div style={{ overflowX: 'auto' }}>
          <table className="cron-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Job</th>
                <th>Schedule</th>
                <th>Last</th>
                <th>Next</th>
                <th style={{ width: 40 }}>Err</th>
              </tr>
            </thead>
            <tbody>
              {enabledCrons.map(job => (
                <tr key={job.id}>
                  <td style={{ textAlign: 'center' }}>{healthIcon(job.status)}</td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{job.name}</div>
                    {job.agentId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{job.agentId}</div>}
                  </td>
                  <td className="cron-schedule">{job.schedule}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatRelativeTime(job.lastRun)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{job.nextRun ? formatRelativeTime(job.nextRun) : '—'}</td>
                  <td style={{ textAlign: 'center', color: (job.consecutiveErrors ?? 0) > 0 ? '#f44336' : 'var(--text-muted)' }}>
                    {(job.consecutiveErrors ?? 0) > 0 ? job.consecutiveErrors : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---- Token Usage ---- */}
      <Section title="Token Usage" emoji="📊" defaultOpen={true}>
        {tokenData ? (
          <div className="token-usage">
            <div className="token-total">
              <span className="token-total-number">{formatTokens(tokenData.total24h)}</span>
              <span className="token-total-label">tokens (24h)</span>
            </div>

            {tokenData.hourly.filter(h => h.tokens > 0).length > 0 && (
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hourly (24h)</h4>
                {tokenData.hourly.filter(h => h.tokens > 0).map((h, i) => (
                  <div key={i} className="token-bar-row">
                    <span className="token-bar-label">{h.hour}</span>
                    <div className="token-bar-track">
                      <div className="token-bar-fill" style={{ width: `${Math.max((h.tokens / maxHourly) * 100, 2)}%` }} />
                    </div>
                    <span className="token-bar-value">{formatTokens(h.tokens)}</span>
                  </div>
                ))}
              </div>
            )}

            {tokenData.agents.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>By Agent (24h)</h4>
                {tokenData.agents.map(a => (
                  <div key={a.name} className="token-agent-row">
                    <span className="token-agent-name">{AGENT_NAMES[a.name] || a.name}</span>
                    <span className="token-agent-tokens">{formatTokens(a.tokens)}</span>
                    <span className="token-agent-pct">{a.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">Token data unavailable</p>
        )}
      </Section>

      {/* ---- Users ---- */}
      <Section title="Users" emoji="👤" count={users.length} defaultOpen={false}>
        {users.map(user => {
          const expanded = expandedUsers.has(user.id);
          return (
            <div key={user.id} className="card" style={{ marginBottom: 'var(--space-sm)' }}>
              <div
                className="card-body"
                onClick={() => setExpandedUsers(prev => {
                  const next = new Set(prev);
                  expanded ? next.delete(user.id) : next.add(user.id);
                  return next;
                })}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{user.name}</strong>
                    <span className="text-muted" style={{ marginLeft: 8 }}>@{user.code}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="badge badge-accent">{user.city}</span>
                    {user.isOwner && <span className="badge badge-success">Owner</span>}
                    <span style={{ color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--card-border)', paddingTop: 'var(--space-md)' }}>
                    {user.preferences && (
                      <div style={{ marginBottom: 'var(--space-md)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Preferences</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {user.preferences.interests?.map(t => <span key={t} className="filter-chip">{t}</span>)}
                          {user.preferences.cuisines?.map(t => <span key={t} className="filter-chip">{t}</span>)}
                          {user.preferences.vibes?.map(t => <span key={t} className="filter-chip">{t}</span>)}
                        </div>
                      </div>
                    )}
                    {user.manifest && (
                      <div style={{ marginBottom: 'var(--space-md)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                          Contexts ({user.manifest.contexts.filter(c => c.active).length} active)
                        </div>
                        {user.manifest.contexts.filter(c => c.active).map(ctx => (
                          <div key={ctx.key} style={{ padding: '6px 0', borderBottom: '1px solid rgba(148,163,184,0.08)', fontSize: '0.85rem' }}>
                            <strong>{ctx.label}</strong>
                            {ctx.city && <span className="text-muted" style={{ marginLeft: 8 }}>{ctx.city}</span>}
                            {ctx.dates && <span className="text-muted" style={{ marginLeft: 8 }}>{ctx.dates}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {user.discoveries && (
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                          Discoveries ({user.discoveries.discoveries.length})
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </Section>
    </main>
  );
}
