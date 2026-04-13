'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { MonitorEntry, MonitorObservation, MonitorChangeKind } from '../../_lib/monitor-inventory';
import type { SignificanceLevel } from '../../_lib/observation-significance';

interface MonitoringAdminClientProps {
  entries: MonitorEntry[];
  updatedAt: string;
  userId: string;
}

// ---- Labels & formatting ----

const STATUS_LABEL: Record<string, string> = {
  priority: '🟠 Priority',
  active: '🟡 Active',
  candidate: '🟣 Candidate',
};

const TYPE_ICON: Record<string, string> = {
  hospitality: '🍽️',
  stay: '🏨',
  development: '🏗️',
  culture: '🎭',
  general: '📍',
};

const SIG_BADGE: Record<string, { icon: string; className: string }> = {
  critical: { icon: '🔴', className: 'sig-critical' },
  notable: { icon: '🟡', className: 'sig-notable' },
  routine: { icon: '⚪', className: 'sig-routine' },
  noise: { icon: '·', className: 'sig-noise' },
};

const CHANGE_LABELS: Record<string, string> = {
  'rating-down': '📉 Rating dropped',
  'rating-up': '📈 Rating improved',
  'closure-signal': '🚫 Closure detected',
  'operational-change': '⚠️ Status changed',
  'price-changed': '💰 Price shifted',
  'description-changed': '📝 Description rewritten',
  'review-count-up': '📊 More reviews',
  'review-count-down': '📊 Reviews disappeared',
  'availability-changed': '🏷️ Availability changed',
  'construction-signal': '🏗️ Construction progress',
  'sentiment-shift': '💬 Sentiment shifted',
  'hours-changed': '🕐 Hours updated',
  'general-update': '🔄 Updated',
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 60) return `${Math.round(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function formatDue(iso: string | undefined): string {
  if (!iso) return 'Not scheduled';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const diffDays = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === -1) return 'Due yesterday';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 7) return `Due in ${diffDays}d`;
  return `Due ${d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
}

// ---- Filters ----

type FilterStatus = 'all' | 'priority' | 'active' | 'candidate';
type FilterType = 'all' | 'hospitality' | 'stay' | 'development' | 'culture' | 'general';
type SortBy = 'status' | 'significance' | 'lastObserved' | 'nextCheck' | 'name';

// ---- Observation detail panel ----

function ObservationRow({ obs }: { obs: MonitorObservation }) {
  const sig = SIG_BADGE[obs.significanceLevel ?? 'noise'];
  return (
    <div className="mon-obs-row">
      <span className="mon-obs-date">{formatRelative(obs.observedAt)}</span>
      <span className="mon-obs-source">{obs.source}</span>
      {sig && <span className={`mon-obs-sig ${sig.className}`}>{sig.icon}</span>}
      {obs.changes.length > 0 ? (
        <span className="mon-obs-changes">
          {obs.changes.map(c => CHANGE_LABELS[c] ?? c).join(', ')}
        </span>
      ) : (
        <span className="mon-obs-no-change">No changes</span>
      )}
      {obs.significanceSummary && (
        <span className="mon-obs-summary">{obs.significanceSummary}</span>
      )}
    </div>
  );
}

function EntryDetail({ entry, onClose, onRemove }: {
  entry: MonitorEntry;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/internal/monitor-inventory?id=${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onRemove(entry.id);
        onClose();
      }
    } finally {
      setRemoving(false);
    }
  }, [entry.id, onRemove, onClose]);

  const sig = SIG_BADGE[entry.peakSignificanceLevel ?? 'noise'];

  return (
    <div className="mon-detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mon-detail-panel">
        <div className="mon-detail-header">
          <div>
            <h2>{entry.name}</h2>
            <span className="mon-detail-city">{entry.city}</span>
          </div>
          <button className="mon-detail-close" onClick={onClose}>✕</button>
        </div>

        <div className="mon-detail-meta">
          <span>{TYPE_ICON[entry.monitorType] ?? '📍'} {entry.monitorType}</span>
          <span>{STATUS_LABEL[entry.monitorStatus] ?? entry.monitorStatus}</span>
          {sig && entry.peakSignificanceLevel !== 'noise' && (
            <span className={sig.className}>{sig.icon} Peak: {entry.peakSignificanceLevel}</span>
          )}
        </div>

        <div className="mon-detail-dates">
          <div><strong>Promoted:</strong> {formatRelative(entry.firstPromotedAt)}</div>
          <div><strong>Last observed:</strong> {formatRelative(entry.lastObservedAt)}</div>
          <div><strong>Next check:</strong> {formatDue(entry.nextCheckAt)}</div>
        </div>

        {entry.monitorReasons.length > 0 && (
          <div className="mon-detail-reasons">
            <strong>Reasons:</strong> {entry.monitorReasons.join(', ')}
          </div>
        )}

        {entry.detectedChangeKinds.length > 0 && (
          <div className="mon-detail-changes">
            <strong>All detected changes:</strong>
            <ul>
              {entry.detectedChangeKinds.map(c => (
                <li key={c}>{CHANGE_LABELS[c] ?? c}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.baselineState && (
          <div className="mon-detail-baseline">
            <strong>Baseline state:</strong>
            <div className="mon-detail-state-grid">
              {entry.baselineState.rating != null && <span>Rating: {entry.baselineState.rating}</span>}
              {entry.baselineState.reviewCount != null && <span>Reviews: {entry.baselineState.reviewCount}</span>}
              {entry.baselineState.priceLevel != null && <span>Price: {'$'.repeat(entry.baselineState.priceLevel + 1)}</span>}
              {entry.baselineState.operationalStatus && <span>Status: {entry.baselineState.operationalStatus}</span>}
            </div>
          </div>
        )}

        {entry.currentState && (
          <div className="mon-detail-current">
            <strong>Current state:</strong>
            <div className="mon-detail-state-grid">
              {entry.currentState.rating != null && <span>Rating: {entry.currentState.rating}</span>}
              {entry.currentState.reviewCount != null && <span>Reviews: {entry.currentState.reviewCount}</span>}
              {entry.currentState.priceLevel != null && <span>Price: {'$'.repeat(entry.currentState.priceLevel + 1)}</span>}
              {entry.currentState.operationalStatus && <span>Status: {entry.currentState.operationalStatus}</span>}
              {entry.currentState.description && <span className="mon-detail-desc">"{entry.currentState.description}"</span>}
            </div>
          </div>
        )}

        <div className="mon-detail-observations">
          <h3>Observations ({entry.observations.length})</h3>
          {entry.observations.length === 0 ? (
            <p className="mon-detail-empty">No observations recorded yet.</p>
          ) : (
            <div className="mon-obs-list">
              {entry.observations.map((obs, i) => (
                <ObservationRow key={`${obs.observedAt}-${i}`} obs={obs} />
              ))}
            </div>
          )}
        </div>

        <div className="mon-detail-actions">
          <button
            className="mon-detail-remove"
            onClick={handleRemove}
            disabled={removing}
          >
            {removing ? 'Removing…' : 'Remove from inventory'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----

export default function MonitoringAdminClient({ entries: initialEntries, updatedAt, userId }: MonitoringAdminClientProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('status');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningObs, setRunningObs] = useState(false);
  const [obsResult, setObsResult] = useState<string | null>(null);

  const handleRemove = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id && e.discoveryId !== id));
  }, []);

  const runObservations = useCallback(async () => {
    setRunningObs(true);
    setObsResult(null);
    try {
      const res = await fetch('/api/internal/run-observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, limit: 10 }),
      });
      const data = await res.json();
      setObsResult(data.message ?? 'Done');
      // Refresh inventory
      const invRes = await fetch('/api/internal/monitor-inventory');
      if (invRes.ok) {
        const inv = await invRes.json();
        setEntries(inv.entries ?? []);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('compass-data-changed'));
        }
      }
    } catch (err) {
      setObsResult('Error running observations');
    } finally {
      setRunningObs(false);
    }
  }, [userId]);

  // Apply filters
  let filtered = entries;
  if (filterStatus !== 'all') {
    filtered = filtered.filter(e => e.monitorStatus === filterStatus);
  }
  if (filterType !== 'all') {
    filtered = filtered.filter(e => e.monitorType === filterType);
  }

  // Apply sort
  const statusRank: Record<string, number> = { priority: 0, active: 1, candidate: 2 };
  const sigRank: Record<string, number> = { critical: 3, notable: 2, routine: 1, noise: 0 };

  filtered = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return (statusRank[a.monitorStatus] ?? 9) - (statusRank[b.monitorStatus] ?? 9);
      case 'significance':
        return (sigRank[b.peakSignificanceLevel ?? 'noise'] ?? 0) - (sigRank[a.peakSignificanceLevel ?? 'noise'] ?? 0)
          || (b.peakSignificanceScore ?? 0) - (a.peakSignificanceScore ?? 0);
      case 'lastObserved': {
        const aT = a.lastObservedAt ? new Date(a.lastObservedAt).getTime() : 0;
        const bT = b.lastObservedAt ? new Date(b.lastObservedAt).getTime() : 0;
        return bT - aT;
      }
      case 'nextCheck': {
        const aT = a.nextCheckAt ? new Date(a.nextCheckAt).getTime() : Infinity;
        const bT = b.nextCheckAt ? new Date(b.nextCheckAt).getTime() : Infinity;
        return aT - bT;
      }
      case 'name':
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  // Stats
  const totalEntries = entries.length;
  const dueNow = entries.filter(e => e.nextCheckAt && new Date(e.nextCheckAt) <= new Date()).length;
  const withChanges = entries.filter(e => e.detectedChangeKinds.length > 0).length;
  const critical = entries.filter(e => e.hasCriticalChange).length;
  const byStatus = {
    priority: entries.filter(e => e.monitorStatus === 'priority').length,
    active: entries.filter(e => e.monitorStatus === 'active').length,
    candidate: entries.filter(e => e.monitorStatus === 'candidate').length,
  };

  const selectedEntry = selectedId ? entries.find(e => e.id === selectedId) : null;

  return (
    <main className="page mon-admin-page">
      <div className="page-header">
        <div className="mon-admin-header">
          <div>
            <h1>Monitoring Inventory</h1>
            <p className="mon-admin-subtitle">
              Durable monitor entries with observation history and change detection.
            </p>
          </div>
          <div className="mon-admin-header-actions">
            <button
              className="mon-admin-run-btn"
              onClick={runObservations}
              disabled={runningObs}
            >
              {runningObs ? '⏳ Running…' : '▶ Run observations'}
            </button>
            <Link href="/admin" className="mon-admin-back">← Admin</Link>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mon-admin-stats">
        <div className="mon-stat">
          <span className="mon-stat-value">{totalEntries}</span>
          <span className="mon-stat-label">Total</span>
        </div>
        <div className="mon-stat">
          <span className="mon-stat-value mon-stat-due">{dueNow}</span>
          <span className="mon-stat-label">Due now</span>
        </div>
        <div className="mon-stat">
          <span className="mon-stat-value">{withChanges}</span>
          <span className="mon-stat-label">With changes</span>
        </div>
        <div className="mon-stat">
          <span className="mon-stat-value mon-stat-critical">{critical}</span>
          <span className="mon-stat-label">Critical</span>
        </div>
        <div className="mon-stat-divider" />
        <div className="mon-stat">
          <span className="mon-stat-value">{byStatus.priority}</span>
          <span className="mon-stat-label">Priority</span>
        </div>
        <div className="mon-stat">
          <span className="mon-stat-value">{byStatus.active}</span>
          <span className="mon-stat-label">Active</span>
        </div>
        <div className="mon-stat">
          <span className="mon-stat-value">{byStatus.candidate}</span>
          <span className="mon-stat-label">Candidate</span>
        </div>
      </div>

      {obsResult && (
        <div className="mon-admin-obs-result">{obsResult}</div>
      )}

      {/* Filters & sort */}
      <div className="mon-admin-controls">
        <div className="mon-admin-filters">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as FilterStatus)}>
            <option value="all">All statuses</option>
            <option value="priority">Priority</option>
            <option value="active">Active</option>
            <option value="candidate">Candidate</option>
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value as FilterType)}>
            <option value="all">All types</option>
            <option value="hospitality">Hospitality</option>
            <option value="stay">Stay</option>
            <option value="development">Development</option>
            <option value="culture">Culture</option>
            <option value="general">General</option>
          </select>
        </div>
        <div className="mon-admin-sort">
          <label>Sort: </label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
            <option value="status">Status</option>
            <option value="significance">Significance</option>
            <option value="lastObserved">Last observed</option>
            <option value="nextCheck">Next check</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* Entry list */}
      {filtered.length === 0 ? (
        <div className="mon-admin-empty">
          <p>No entries match your filters.</p>
        </div>
      ) : (
        <div className="mon-admin-list">
          {filtered.map(entry => {
            const sig = SIG_BADGE[entry.peakSignificanceLevel ?? 'noise'];
            const isDue = entry.nextCheckAt && new Date(entry.nextCheckAt) <= new Date();
            return (
              <div
                key={entry.id}
                className={`mon-entry${isDue ? ' mon-entry-due' : ''}${entry.hasCriticalChange ? ' mon-entry-critical' : ''}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="mon-entry-top">
                  <span className="mon-entry-icon">{TYPE_ICON[entry.monitorType] ?? '📍'}</span>
                  <span className="mon-entry-name">{entry.name}</span>
                  <span className={`mon-entry-status mon-entry-status-${entry.monitorStatus}`}>
                    {STATUS_LABEL[entry.monitorStatus] ?? entry.monitorStatus}
                  </span>
                </div>
                <div className="mon-entry-meta">
                  <span>{entry.city}</span>
                  <span>· {entry.type}</span>
                  <span>· {entry.observations.length} obs</span>
                  {entry.lastObservedAt && <span>· Last: {formatRelative(entry.lastObservedAt)}</span>}
                  <span>· {formatDue(entry.nextCheckAt)}</span>
                </div>
                {entry.detectedChangeKinds.length > 0 && (
                  <div className="mon-entry-changes">
                    {entry.detectedChangeKinds.slice(0, 4).map(c => (
                      <span key={c} className="mon-change-tag">{CHANGE_LABELS[c] ?? c}</span>
                    ))}
                    {entry.detectedChangeKinds.length > 4 && (
                      <span className="mon-change-more">+{entry.detectedChangeKinds.length - 4}</span>
                    )}
                  </div>
                )}
                {sig && entry.peakSignificanceLevel && entry.peakSignificanceLevel !== 'noise' && (
                  <div className={`mon-entry-sig ${sig.className}`}>
                    {sig.icon} {entry.latestSignificanceSummary ?? entry.peakSignificanceLevel}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mon-admin-footer">
        Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <EntryDetail
          entry={selectedEntry}
          onClose={() => setSelectedId(null)}
          onRemove={handleRemove}
        />
      )}
    </main>
  );
}
