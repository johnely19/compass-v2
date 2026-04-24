'use client';

import { useState, useEffect, useCallback } from 'react';
import WorkerCard from '../_components/WorkerCard';

/* ---- Types ---- */

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'dormant';
  lastActivity: string | number | null;
  model: string | null;
  tokenUsage: { input: number; output: number } | null;
  sessionCount: number;
  totalTokens: number;
  contextTokens: number;
}

interface AgentHealthStats {
  totalAgents: number;
  activeAgents: number;
  placeCards: number;
  cottages: number;
  activeContexts: number;
  activeTrips?: number; // compat
  totalTokens24h: number;
}

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastRun: string | number | null;
  status: 'healthy' | 'missed' | 'error';
  health?: 'healthy' | 'warning' | 'error' | 'unknown';
  lastError: string | null;
  agentId?: string;
  nextRun?: string | number | null;
  lastDuration?: number | null;
  consecutiveErrors?: number;
}

interface DiscoActivityData {
  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastJobName: string | null;
  runsToday: number;
  placesScannedToday: number;
  discoveriesToday: number;
  changesDetectedToday: number;
  errorsToday: number;
  errorDetails: string[];
  monitoring: {
    total: number;
    dueNow: number;
    byStatus: {
      candidate: number;
      active: number;
      priority: number;
    };
    byType: Record<string, number>;
    nextUp: Array<{
      id: string;
      name: string;
      contextKey: string;
      status: string;
      type: string;
      dueNow: boolean;
      nextCheckAt?: string;
      lastObservedAt?: string;
      explanation?: string;
    }>;
  };
  jobs: Array<{
    id: string;
    name: string;
    enabled: boolean;
    lastRun: number | null;
    lastStatus: string | null;
    consecutiveErrors: number;
    lastError: string | null;
  }>;
}

interface WorkerInfo {
  sessionKey: string;
  status: string;
  model: string;
  totalTokens: number;
  startedAt: number;
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

export interface AdminPageData {
  agents: AgentInfo[];
  stats: AgentHealthStats | null;
  crons: CronJob[];
  tokenData: TokenData | null;
  users: UserWithData[];
  discoActivity: DiscoActivityData | null;
  workers: WorkerInfo[];
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

function formatMonitorDue(ts?: string): string {
  if (!ts) return 'unscheduled';
  const diffMs = new Date(ts).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return 'unscheduled';
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'due now';
  if (diffDays === 1) return 'due in 1 day';
  if (diffDays < 14) return `due in ${diffDays} days`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffWeeks <= 1) return 'due in 1 week';
  return `due in ${diffWeeks} weeks`;
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

const AGENT_NAMES: Record<string, string> = { main: 'Charlie', devclaw: 'DevClaw', 'devclaw-workers': 'Workers', disco: 'Disco', concierge: 'Concierge' };
const AGENT_COLORS: Record<string, string> = {
  main:             '#6366f1',  // indigo — orchestrator
  charlie:          '#6366f1',
  devclaw:          '#f59e0b',  // amber — pipeline
  'devclaw-workers':'#d97706',  // darker amber — worker subagents
  disco:            '#22c55e',  // green — discovery
  concierge:        '#e879f9',  // fuchsia — chat
};
const AGENT_ROLES: Record<string, string> = { main: 'Orchestrator', devclaw: 'Development', disco: 'Discovery & Research' };
const AGENT_ORDER: Record<string, number> = { main: 0, devclaw: 1, disco: 2 };

/* ---- Collapsible Section ---- */

function Section({ title, emoji, count, children }: {
  title: string; emoji: string; defaultOpen?: boolean; count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-v2-section">
      <div className="admin-v2-section-header">
        <h2><span>{emoji}</span> {title}{count != null ? ` (${count})` : ''}</h2>
      </div>
      <div className="admin-v2-section-content">{children}</div>
    </div>
  );
}

/* ---- Main Component ---- */

type AdminTab = 'overview' | 'crons';

const EMPTY_ADMIN_PAGE_DATA: AdminPageData = {
  agents: [],
  stats: null,
  crons: [],
  tokenData: null,
  users: [],
  discoActivity: null,
  workers: [],
};

export default function AdminClient({ initialData = EMPTY_ADMIN_PAGE_DATA }: { initialData?: AdminPageData }) {
  const [agents, setAgents] = useState<AgentInfo[]>(initialData.agents);
  const [stats, setStats] = useState<AgentHealthStats | null>(initialData.stats);
  const [crons, setCrons] = useState<CronJob[]>(initialData.crons);
  const [tokenData, setTokenData] = useState<TokenData | null>(initialData.tokenData);
  const [users, setUsers] = useState<UserWithData[]>(initialData.users);
  const [discoActivity, setDiscoActivity] = useState<DiscoActivityData | null>(initialData.discoActivity);
  const [workers, setWorkers] = useState<WorkerInfo[]>(initialData.workers);
  const [loading, setLoading] = useState(() => initialData === EMPTY_ADMIN_PAGE_DATA);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [resettingUser, setResettingUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [agentsRes, cronsRes, tokensRes, usersRes, discoRes] = await Promise.all([
        fetch('/api/admin/agents'),
        fetch('/api/admin/crons'),
        fetch('/api/admin/tokens'),
        fetch('/api/admin/users'),
        fetch('/api/admin/disco'),
      ]);
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
        setStats(data.stats || null);
        setWorkers(data.workers || []);
      }
      if (cronsRes.ok) setCrons((await cronsRes.json()).jobs || []);
      if (tokensRes.ok) setTokenData(await tokensRes.json());
      if (usersRes.ok) setUsers((await usersRes.json()).users || []);
      if (discoRes.ok) setDiscoActivity(await discoRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const resetUser = useCallback(async (userId: string, userName: string) => {
    const confirmed = window.confirm(`Reset all data for ${userName}? This cannot be undone.`);
    if (!confirmed) return;

    setResettingUser(userId);
    try {
      const res = await fetch('/api/admin/reset-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        alert(`Reset complete: user data cleared`);
      } else {
        const err = await res.json();
        alert(`Reset failed: ${err.error}`);
      }
    } catch (e) {
      alert(`Reset failed: ${e}`);
    } finally {
      setResettingUser(null);
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
    (AGENT_ORDER[a.id || a.name] ?? 99) - (AGENT_ORDER[b.id || b.name] ?? 99)
  );
  const coreAgents = sortedAgents.filter(a => ['main', 'devclaw', 'disco'].includes(a.id || a.name));
  const activeCount = agents.filter(a => a.status === 'active').length;
  const enabledCrons = crons.filter(j => j.enabled !== false);
  const healthIcon = (s: string) => s === 'healthy' ? '🟢' : s === 'missed' || s === 'warning' ? '🟡' : s === 'error' ? '🔴' : '⚪';
  const fmtDuration = (ms: number | null | undefined) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const maxHourly = tokenData ? Math.max(...tokenData.hourly.map(h => h.tokens), 1) : 1;

  return (
    <main className="page" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h1>Admin</h1>
        <p className="text-muted">{agents.length} agents · {enabledCrons.length} cron jobs · {formatTokens(tokenData?.total24h ?? 0)} tokens (24h)</p>
      </div>

      {/* ── Tabs ── */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'overview' ? 'admin-tab-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`admin-tab ${activeTab === 'crons' ? 'admin-tab-active' : ''}`}
          onClick={() => setActiveTab('crons')}
        >
          Cron Jobs <span className="admin-tab-badge">{enabledCrons.length}</span>
        </button>
      </div>

      {activeTab === 'crons' && (
        <Section title="Cron Jobs" emoji="⏰" count={enabledCrons.length}>
          <div style={{ overflowX: 'auto' }}>
            <table className="cron-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ textAlign: 'left' }}>Job</th>
                  <th>Schedule</th>
                  <th>Last</th>
                  <th>Dur.</th>
                  <th>Next</th>
                  <th style={{ width: 40 }}>Err</th>
                </tr>
              </thead>
              <tbody>
                {enabledCrons.map(job => {
                const health = job.health || job.status;
                return (
                <tr key={job.id}>
                  <td style={{ textAlign: 'center' }}>{healthIcon(health)}</td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{job.name}</div>
                    {job.agentId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{job.agentId}</div>}
                  </td>
                  <td className="cron-schedule">{job.schedule}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatRelativeTime(job.lastRun)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{fmtDuration(job.lastDuration)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{job.nextRun ? formatRelativeTime(job.nextRun) : '—'}</td>
                  <td style={{ textAlign: 'center', color: (job.consecutiveErrors ?? 0) > 0 ? '#f44336' : 'var(--text-muted)' }}>
                    {(job.consecutiveErrors ?? 0) > 0 ? job.consecutiveErrors : '—'}
                  </td>
                </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {activeTab === 'overview' && <>

      {/* ---- Agent Health ---- */}
      <Section title="Agent Health" emoji="🤖">
        {/* Stats row */}
        {stats && (
          <div className="health-stats">
            <div className="health-stat-card"><strong>{stats.totalAgents}</strong><span>Agents</span></div>
            <div className="health-stat-card"><strong>{stats.activeAgents}</strong><span>Active</span></div>
            <div className="health-stat-card"><strong>{stats.placeCards}</strong><span>Place Cards</span></div>
            <div className="health-stat-card"><strong>{stats.cottages}</strong><span>Cottages</span></div>
            <div className="health-stat-card"><strong>{stats.activeContexts ?? stats.activeTrips ?? 0}</strong><span>Contexts</span></div>
            <div className="health-stat-card"><strong>{formatTokens(tokenData?.total24h ?? stats.totalTokens24h)}</strong><span>Tokens (24h)</span></div>
          </div>
        )}

        {/* Agent cards */}
        <div className="health-grid">
          {/* Core agents from API */}
          {(coreAgents.length > 0 ? coreAgents : sortedAgents).map(agent => {
            const agentId = agent.id || agent.name;
            const pressure = agent.contextTokens > 0
              ? (agent.totalTokens / agent.contextTokens) * 100 : 0;
            const tokenInfo = tokenData?.agents.find(a =>
              a.name === agentId || a.name === (agentId === 'main' ? 'charlie' : agentId)
            );
            const agentColor = AGENT_COLORS[agentId] || '#94a3b8';
            return (
              <div key={agentId} className="health-card" style={{ borderTop: `3px solid ${agentColor}` }}>
                <div className="health-card-header">
                  <div>
                    <div className="health-agent-name">{AGENT_NAMES[agentId] || agentId}</div>
                    <div className="health-agent-role">{AGENT_ROLES[agentId] || agent.role}</div>
                  </div>
                  <span className={`health-status-badge health-status-${agent.status}`}>
                    {agent.status}
                  </span>
                </div>
                <div className="health-card-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="health-model">{shortModel(agent.model)}</span>
                  <span>{formatRelativeTime(agent.lastActivity)}</span>
                </div>
                <div className="health-card-stats">
                  {agent.sessionCount} session{agent.sessionCount !== 1 ? 's' : ''} (24h)
                </div>
                <div className="health-pressure-bar">
                  <div className="health-pressure-label">
                    <span>Context</span>
                    <span>{Math.round(pressure)}%</span>
                  </div>
                  <div className="health-pressure-track">
                    <div className="health-pressure-fill" style={{
                      width: `${Math.min(Math.max(pressure, 1), 100)}%`,
                      background: pressure > 80 ? '#f44336' : pressure > 50 ? '#FF9800' : '#4CAF50',
                    }} />
                  </div>
                </div>
                {tokenInfo && tokenInfo.tokens > 0 && (
                  <div className="health-card-tokens">
                    <span className="health-token-value">{formatTokens(tokenInfo.tokens)}</span>
                    <span className="health-token-label">tokens (24h)</span>
                    <span className="health-token-pct">{tokenInfo.pct}%</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Concierge card — from tokenData if not already in agents list */}
          {(() => {
            const conciergeToken = tokenData?.agents.find(a => a.name === 'concierge');
            const alreadyShown = (coreAgents.length > 0 ? coreAgents : sortedAgents).some(
              a => (a.id || a.name) === 'concierge'
            );
            if (!conciergeToken || alreadyShown) return null;
            return (
              <div key="concierge" className="health-card health-card-secondary" style={{ borderTop: `3px solid ${AGENT_COLORS.concierge}` }}>
                <div className="health-card-header">
                  <div>
                    <div className="health-agent-name">Concierge</div>
                    <div className="health-agent-role">Chat Assistant</div>
                  </div>
                  <span className="health-status-badge health-status-dormant">dormant</span>
                </div>
                <div className="health-card-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="health-model">claude-sonnet-4-6</span>
                  <span>—</span>
                </div>
                <div className="health-card-stats">— sessions (24h)</div>
                <div className="health-pressure-bar">
                  <div className="health-pressure-label"><span>Context</span><span>—</span></div>
                  <div className="health-pressure-track">
                    <div className="health-pressure-fill" style={{ width: '1%', background: '#4CAF50' }} />
                  </div>
                </div>
                {conciergeToken.tokens > 0 && (
                  <div className="health-card-tokens">
                    <span className="health-token-value">{formatTokens(conciergeToken.tokens)}</span>
                    <span className="health-token-label">tokens (24h)</span>
                    <span className="health-token-pct">{conciergeToken.pct}%</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </Section>

      {/* ---- Workers (sub-agents) ---- */}
      {workers.length > 0 && (
        <Section title="Workers" emoji="🔨" count={workers.length}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', width: '100%' }}>
            {workers
              .filter(w => {
                // Filter out UUID-style sessions (no structured name)
                const sub = w.sessionKey.replace(/^agent:main:subagent:/, '');
                const parts = sub.split('-');
                return parts.length >= 4 && !sub.match(/^[0-9a-f]{8}-[0-9a-f]{4}/);
              })
              .map(w => <WorkerCard key={w.sessionKey} worker={w} />)}
          </div>
        </Section>
      )}

      {/* ---- Disco Activity ---- */}
      <Section title="Disco Activity" emoji="🔍">
        {discoActivity ? (
          <div>
            {/* Key metrics row */}
            <div className="health-stats" style={{ marginBottom: 'var(--space-md)' }}>
              <div className="health-stat-card">
                <strong style={{ color: discoActivity.lastRunStatus === 'error' ? '#f44336' : 'var(--text-primary)' }}>
                  {formatRelativeTime(discoActivity.lastRunAtMs)}
                </strong>
                <span>Last Run</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.runsToday}</strong>
                <span>Runs Today</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.placesScannedToday}</strong>
                <span>Places Found</span>
              </div>
              <div className="health-stat-card">
                <strong style={{ color: discoActivity.discoveriesToday > 0 ? '#22c55e' : 'var(--text-primary)' }}>
                  {discoActivity.discoveriesToday}
                </strong>
                <span>Pushed Today</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.changesDetectedToday}</strong>
                <span>Changes</span>
              </div>
              <div className="health-stat-card">
                <strong style={{ color: discoActivity.errorsToday > 0 ? '#f44336' : 'var(--text-muted)' }}>
                  {discoActivity.errorsToday}
                </strong>
                <span>Errors</span>
              </div>
            </div>

            <div className="health-stats" style={{ marginBottom: 'var(--space-md)' }}>
              <div className="health-stat-card">
                <strong>{discoActivity.monitoring.total}</strong>
                <span>Monitored Places</span>
              </div>
              <div className="health-stat-card">
                <strong style={{ color: discoActivity.monitoring.dueNow > 0 ? '#f59e0b' : 'var(--text-primary)' }}>
                  {discoActivity.monitoring.dueNow}
                </strong>
                <span>Due Now</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.monitoring.byStatus.priority}</strong>
                <span>Priority Monitor</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.monitoring.byStatus.active}</strong>
                <span>Active Monitor</span>
              </div>
              <div className="health-stat-card">
                <strong>{discoActivity.monitoring.byStatus.candidate}</strong>
                <span>Candidate Monitor</span>
              </div>
            </div>

            {/* Last run detail */}
            {discoActivity.lastJobName && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: discoActivity.errorDetails.length > 0 ? 'var(--space-sm)' : 0 }}>
                Last: <span style={{ color: 'var(--text-secondary)' }}>{discoActivity.lastJobName}</span>
                {discoActivity.lastRunStatus && (
                  <span style={{
                    marginLeft: 8,
                    color: discoActivity.lastRunStatus === 'ok' ? '#22c55e' : '#f44336',
                    fontWeight: 500,
                  }}>
                    {discoActivity.lastRunStatus === 'ok' ? '✓' : '✗'} {discoActivity.lastRunStatus}
                  </span>
                )}
              </div>
            )}

            {/* Error details */}
            {discoActivity.errorDetails.length > 0 && (
              <div style={{
                marginTop: 'var(--space-sm)',
                padding: '8px 12px',
                background: 'rgba(244, 67, 54, 0.08)',
                borderLeft: '3px solid #f44336',
                borderRadius: 4,
                fontSize: '0.78rem',
                color: '#f44336',
              }}>
                {discoActivity.errorDetails.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            {discoActivity.monitoring.nextUp.length > 0 && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Monitoring queue
                  </span>
                  <a href="/admin/monitoring" style={{ fontSize: '0.75rem', color: 'var(--color-link, #2563eb)', textDecoration: 'none' }}>
                    Full inventory →
                  </a>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {discoActivity.monitoring.nextUp.map((item) => (
                    <div
                      key={`${item.contextKey}-${item.id}`}
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--surface-secondary)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{item.name}</strong>
                        <span style={{ fontSize: '0.78rem', color: item.dueNow ? '#f59e0b' : 'var(--text-muted)' }}>
                          {item.dueNow ? 'Due now' : formatMonitorDue(item.nextCheckAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {item.status} · {item.type} · {item.contextKey}
                      </div>
                      {item.explanation && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                          {item.explanation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-job mini table */}
            {discoActivity.jobs.length > 0 && (
              <div style={{ marginTop: 'var(--space-md)', overflowX: 'auto' }}>
                <table className="cron-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }}></th>
                      <th style={{ textAlign: 'left' }}>Job</th>
                      <th>Last Run</th>
                      <th>Errs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoActivity.jobs.map(job => {
                      const statusIcon = !job.lastStatus ? '⚪'
                        : job.consecutiveErrors > 0 ? '🔴'
                        : job.lastStatus === 'ok' ? '🟢' : '🟡';
                      return (
                        <tr key={job.id}>
                          <td style={{ textAlign: 'center', fontSize: '0.75rem' }}>{statusIcon}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{job.name}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatRelativeTime(job.lastRun)}</td>
                          <td style={{ textAlign: 'center', fontSize: '0.78rem', color: job.consecutiveErrors > 0 ? '#f44336' : 'var(--text-muted)' }}>
                            {job.consecutiveErrors > 0 ? job.consecutiveErrors : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>Disco data unavailable</p>
        )}
      </Section>

      {/* ---- Token Usage (hourly chart) ---- */}
      <Section title="Token Usage (24h)" emoji="📈">
        {tokenData ? (
          <div className="token-usage">
            <div className="token-total">
              <span className="token-total-number">{formatTokens(tokenData.total24h)}</span>
              <span className="token-total-label">tokens (24h)</span>
            </div>
            {/* Agent color legend */}
            <div className="agent-color-legend">
              {Object.entries(AGENT_COLORS).filter(([a]) => a !== 'charlie').map(([agent, color]) => (
                <div key={agent} className="agent-color-dot">
                  <div className="agent-color-swatch" style={{ background: color }} />
                  {AGENT_NAMES[agent] || agent}
                </div>
              ))}
            </div>

            {tokenData.hourly.length > 0 && (
              <div>
                {[...tokenData.hourly].reverse().map((h, i) => {
                  const byAgent = (h as unknown as { byAgent?: Record<string,number> }).byAgent || {};
                  const isEmpty = h.tokens === 0;
                  const totalWidth = isEmpty ? 0 : Math.max((h.tokens / maxHourly) * 100, 2);
                  // Build stacked segments in agent order
                  const agentOrder = ['main', 'devclaw', 'devclaw-workers', 'disco', 'concierge'];
                  const segments = agentOrder
                    .filter(a => (byAgent[a] ?? 0) > 0)
                    .map(a => ({
                      agent: a,
                      pct: ((byAgent[a] ?? 0) / h.tokens) * totalWidth,
                      color: AGENT_COLORS[a] || '#94a3b8',
                    }));
                  // Add any unknown agents
                  Object.entries(byAgent).forEach(([a, v]) => {
                    if (!agentOrder.includes(a) && v > 0) {
                      segments.push({ agent: a, pct: (v / h.tokens) * totalWidth, color: '#94a3b8' });
                    }
                  });
                  return (
                  <div key={i} className={`token-bar-row ${isEmpty ? 'token-bar-row-empty' : ''}`}>
                    <span className="token-bar-label">{h.hour}</span>
                    <div className="token-bar-track">
                      {isEmpty ? (
                        <div className="token-bar-idle" />
                      ) : segments.length > 0 ? segments.map((seg, si) => (
                        <div key={si} className="token-bar-segment" style={{ width: `${seg.pct}%`, background: seg.color }} title={`${AGENT_NAMES[seg.agent] || seg.agent}`} />
                      )) : (
                        <div className="token-bar-fill" style={{ width: `${totalWidth}%` }} />
                      )}
                    </div>
                    <span className="token-bar-value" style={{ opacity: isEmpty ? 0.3 : 1 }}>
                      {isEmpty ? '—' : formatTokens(h.tokens)}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">Token data unavailable</p>
        )}
      </Section>

      {/* ---- Users ---- */}
      <Section title="Users" emoji="👤" count={users.length}>
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
                    {!user.isOwner && (
                      <button
                        className="btn btn-sm"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          resetUser(user.id, user.name);
                        }}
                        disabled={resettingUser === user.id}
                      >
                        {resettingUser === user.id ? 'Resetting...' : 'Reset'}
                      </button>
                    )}
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

      </>}  {/* end overview tab */}

    </main>
  );
}
