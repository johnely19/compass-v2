'use client';

import { useState, useEffect } from 'react';
import type { DiscoveryType } from '../_lib/types';

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
      type: DiscoveryType;
      city: string;
      contextKey: string;
    }>;
  } | null;
}

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

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastRun: string | null;
  status: 'healthy' | 'missed' | 'error';
  lastError: string | null;
}

type TabId = 'users' | 'agents' | 'crons' | 'tokens';

const tabs: { id: TabId; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'agents', label: 'Agents' },
  { id: 'crons', label: 'Cron Jobs' },
  { id: 'tokens', label: 'Tokens' },
];

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function getStatusIcon(status: 'active' | 'idle' | 'dormant'): string {
  switch (status) {
    case 'active': return '🟢';
    case 'idle': return '🟡';
    case 'dormant': return '🔴';
  }
}

function getCronStatusIcon(status: 'healthy' | 'missed' | 'error'): string {
  switch (status) {
    case 'healthy': return '🟢';
    case 'missed': return '🟡';
    case 'error': return '🔴';
  }
}

function countByType(discoveries: Array<{ type: DiscoveryType }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of discoveries) {
    counts[d.type] = (counts[d.type] || 0) + 1;
  }
  return counts;
}

interface TokenData {
  total24h: number;
  hourly: Array<{ hour: string; tokens: number }>;
  agents: Array<{ name: string; tokens: number; pct: number }>;
}

export default function AdminClient() {
  const [activeTab, setActiveTab] = useState<TabId>('users');
  const [users, setUsers] = useState<UserWithData[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchData() {
      try {
        const [usersRes, agentsRes, cronsRes, tokensRes] = await Promise.all([
          fetch('/api/admin/users'),
          fetch('/api/admin/agents'),
          fetch('/api/admin/crons'),
          fetch('/api/admin/tokens'),
        ]);

        const [usersData, agentsData, cronsData] = await Promise.all([
          usersRes.ok ? usersRes.json() : { users: [] },
          agentsRes.ok ? agentsRes.json() : { agents: [] },
          cronsRes.ok ? cronsRes.json() : { jobs: [] },
        ]);

        if (tokensRes.ok) {
          setTokenData(await tokensRes.json());
        }

        setUsers(usersData.users || []);
        setAgents(agentsData.agents || []);
        setCrons(cronsData.jobs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const toggleUser = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Admin Dashboard</h1>
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Admin Dashboard</h1>
          <p className="text-danger">Error: {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Admin Dashboard</h1>
        <p>System monitoring and management</p>
      </div>

      <div className="review-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`review-tab ${activeTab === tab.id ? 'review-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <div className="admin-section">
          <div className="section-header">
            <h2>User Management</h2>
            <span className="section-count">{users.length} users</span>
          </div>

          <div className="admin-users">
            {users.map((user) => (
              <div key={user.id} className="card admin-user-card">
                <div
                  className="admin-user-header"
                  onClick={() => toggleUser(user.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="admin-user-info">
                    <span className="admin-user-name">{user.name}</span>
                    <span className="admin-user-code">@{user.code}</span>
                  </div>
                  <div className="admin-user-meta">
                    <span className="badge badge-accent">{user.city}</span>
                    {user.isOwner && <span className="badge badge-success">Owner</span>}
                    <span className="admin-user-created">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </span>
                    <span className="admin-expand-icon">
                      {expandedUsers.has(user.id) ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {expandedUsers.has(user.id) && (
                  <div className="admin-user-details">
                    {user.preferences && (
                      <div className="admin-detail-section">
                        <h4>Preferences</h4>
                        <div className="admin-tags">
                          {user.preferences.interests?.map((tag) => (
                            <span key={tag} className="filter-chip">{tag}</span>
                          ))}
                          {user.preferences.cuisines?.map((tag) => (
                            <span key={tag} className="filter-chip">{tag}</span>
                          ))}
                          {user.preferences.vibes?.map((tag) => (
                            <span key={tag} className="filter-chip">{tag}</span>
                          ))}
                          {user.preferences.avoidances?.map((tag) => (
                            <span key={tag} className="filter-chip filter-chip-avoid">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {user.manifest && (
                      <div className="admin-detail-section">
                        <h4>Active Contexts ({user.manifest.contexts.filter(c => c.active).length})</h4>
                        <div className="admin-contexts">
                          {user.manifest.contexts.filter(c => c.active).map((ctx) => (
                            <div key={ctx.key} className="admin-context-item">
                              <span className="admin-context-emoji">{ctx.key.split(':')[0] === 'trip' ? '✈️' : ctx.key.split(':')[0] === 'outing' ? '🎯' : '📡'}</span>
                              <span className="admin-context-label">{ctx.label}</span>
                              {ctx.city && <span className="badge badge-muted">{ctx.city}</span>}
                              {ctx.dates && <span className="admin-context-dates">{ctx.dates}</span>}
                              <div className="admin-context-focus">
                                {ctx.focus.map((f) => (
                                  <span key={f} className="filter-chip">{f}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {user.discoveries && (
                      <div className="admin-detail-section">
                        <h4>Discoveries ({user.discoveries.discoveries.length})</h4>
                        <div className="admin-discovery-stats">
                          {Object.entries(countByType(user.discoveries.discoveries)).map(
                            ([type, count]) => (
                              <span key={type} className="badge badge-accent">
                                {type}: {count}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="admin-section">
          <div className="section-header">
            <h2>Agent Health</h2>
            <span className="section-count">{agents.length} agents</span>
          </div>

          <div className="grid grid-3">
            {agents.map((agent) => (
              <div key={agent.name} className="card admin-agent-card">
                <div className="card-body">
                  <div className="admin-agent-header">
                    <span className="admin-agent-name">{agent.name}</span>
                    <span className="admin-agent-status">
                      {getStatusIcon(agent.status)} {agent.status}
                    </span>
                  </div>
                  {agent.model && (
                    <div className="admin-agent-model">
                      Model: {agent.model}
                    </div>
                  )}
                  {agent.lastActivity && (
                    <div className="admin-agent-activity">
                      Last activity: {formatDate(agent.lastActivity)}
                    </div>
                  )}
                  {agent.tokenUsage && (
                    <div className="admin-agent-tokens">
                      Tokens: {agent.tokenUsage.input.toLocaleString()} in /{' '}
                      {agent.tokenUsage.output.toLocaleString()} out
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'crons' && (
        <div className="admin-section">
          <div className="section-header">
            <h2>Cron Job Monitor</h2>
            <span className="section-count">{crons.length} jobs</span>
          </div>

          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Job Name</th>
                  <th>Schedule</th>
                  <th>Last Run</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className="admin-cron-status">
                        {getCronStatusIcon(job.status)} {job.status}
                      </span>
                    </td>
                    <td>
                      {job.name}
                      {!job.enabled && <span className="badge badge-muted">Disabled</span>}
                    </td>
                    <td className="admin-table-schedule">{job.schedule}</td>
                    <td>{formatDate(job.lastRun)}</td>
                    <td className="admin-table-error">
                      {job.lastError || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'tokens' && (
        <div className="admin-section">
          <div className="section-header">
            <h2>Token Usage (24h)</h2>
            {tokenData && (
              <span className="section-count">
                {tokenData.total24h.toLocaleString()} tokens
              </span>
            )}
          </div>

          {tokenData ? (
            <>
              {/* Per-agent breakdown */}
              <div className="grid grid-2" style={{ marginBottom: 'var(--space-lg)' }}>
                {tokenData.agents.map((agent) => (
                  <div key={agent.name} className="card">
                    <div className="card-body">
                      <div className="admin-agent-header">
                        <span className="admin-agent-name">{agent.name}</span>
                        <span className="text-muted">{agent.pct}%</span>
                      </div>
                      <div className="admin-token-stats">
                        <div className="admin-token-row">
                          <span>Tokens:</span>
                          <span className="admin-token-value">
                            {agent.tokens.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {/* Simple bar */}
                      <div style={{
                        marginTop: '8px',
                        height: '4px',
                        borderRadius: '2px',
                        background: 'var(--bg-secondary)',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${agent.pct}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          borderRadius: '2px',
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Hourly bars */}
              <div className="card">
                <div className="card-body">
                  <h3>Hourly Distribution</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px', marginTop: 'var(--space-md)' }}>
                    {tokenData.hourly.map((h, i) => {
                      const maxTokens = Math.max(...tokenData.hourly.map(x => x.tokens), 1);
                      const height = (h.tokens / maxTokens) * 100;
                      return (
                        <div
                          key={i}
                          title={`${h.hour}: ${h.tokens.toLocaleString()} tokens`}
                          style={{
                            flex: 1,
                            height: `${Math.max(height, 2)}%`,
                            background: h.tokens > 0 ? 'var(--accent)' : 'var(--bg-secondary)',
                            borderRadius: '2px 2px 0 0',
                            minWidth: '4px',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p className="text-muted">Token usage data unavailable</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
