'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { WatchItem } from './page';

interface WatchingClientProps {
  userId: string;
  items: WatchItem[];
}

const TYPE_ICON: Record<string, string> = {
  hospitality: '🍽️',
  stay: '🏨',
  development: '🏗️',
  culture: '🎭',
  general: '📍',
};

const STATUS_LABEL: Record<string, string> = {
  priority: 'Priority',
  active: 'Active',
  candidate: 'Candidate',
};

const SIGNIFICANCE_BADGE: Record<string, { icon: string; className: string }> = {
  critical: { icon: '🔴', className: 'sig-critical' },
  notable: { icon: '🟡', className: 'sig-notable' },
  routine: { icon: '⚪', className: 'sig-routine' },
};

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  const diffDays = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === -1) return 'Due yesterday';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 7) return `Due in ${diffDays}d`;
  if (diffDays <= 60) return `Due in ~${Math.round(diffDays / 7)}w`;
  return `Due ${d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
}

function formatLastSeen(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const diffDays = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Last seen today';
  if (diffDays === 1) return 'Last seen yesterday';
  if (diffDays <= 14) return `Last seen ${diffDays}d ago`;
  return `Last seen ${d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
}

function placeHref(item: WatchItem): string {
  const pid = item.placeId ?? item.id;
  return `/review/${item.contextKey}#${pid}`;
}

function WatchRow({
  item,
  onCheckin,
}: {
  item: WatchItem & { checkedIn?: boolean };
  onCheckin: (item: WatchItem) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleCheckin = useCallback(async () => {
    setLoading(true);
    try {
      await onCheckin(item);
    } finally {
      setLoading(false);
    }
  }, [item, onCheckin]);

  const dueLine = formatDate(item.monitorNextCheckAt);
  const lastLine = formatLastSeen(item.monitorLastObservedAt);

  return (
    <div className={`watch-row${item.dueNow ? ' watch-row-due' : ''}${item.checkedIn ? ' watch-row-checked' : ''}`}>
      <span className="watch-row-icon">{TYPE_ICON[item.monitorType] ?? '📍'}</span>
      <div className="watch-row-body">
        <div className="watch-row-top">
          <Link href={placeHref(item)} className="watch-row-name">{item.name}</Link>
          <span className={`watch-row-status watch-row-status-${item.monitorStatus}`}>
            {item.dueNow ? 'Due now' : STATUS_LABEL[item.monitorStatus] ?? item.monitorStatus}
          </span>
        </div>
        <div className="watch-row-meta">
          <span>{item.city}</span>
          {item.contextLabel && <span>· {item.contextLabel}</span>}
          {item.monitorCadence && <span>· {item.monitorCadence}</span>}
        </div>
        {item.monitorExplanation && (
          <p className="watch-row-reason">{item.monitorExplanation}</p>
        )}
        <div className="watch-row-timing">
          {dueLine && <span className={item.dueNow ? 'watch-timing-due' : 'watch-timing-next'}>{dueLine}</span>}
          {lastLine && <span className="watch-timing-last">{lastLine}</span>}
          {item.observationCount != null && item.observationCount > 0 && (
            <span className="watch-timing-obs">{item.observationCount} obs</span>
          )}
        </div>
        {item.significanceLevel && item.significanceLevel !== 'noise' && (
          <div className={`watch-row-significance ${SIGNIFICANCE_BADGE[item.significanceLevel]?.className ?? ''}`}>
            <span className="sig-icon">{SIGNIFICANCE_BADGE[item.significanceLevel]?.icon ?? ''}</span>
            <span className="sig-label">{item.significanceSummary ?? item.significanceLevel}</span>
          </div>
        )}
        {item.monitorDimensions && item.monitorDimensions.length > 0 && (
          <ul className="watch-row-dims">
            {item.monitorDimensions.slice(0, 3).map(dim => (
              <li key={dim.key} title={dim.description}>{dim.label}</li>
            ))}
          </ul>
        )}
        <div className="watch-row-actions">
          {item.checkedIn ? (
            <span className="watch-checkin-done">✓ Marked as checked</span>
          ) : (
            <button
              className="watch-checkin-btn"
              onClick={handleCheckin}
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Mark checked'}
            </button>
          )}
          <Link href={placeHref(item)} className="watch-view-link">View place →</Link>
        </div>
      </div>
    </div>
  );
}

export default function WatchingClient({ userId, items }: WatchingClientProps) {
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());

  const handleCheckin = useCallback(async (item: WatchItem) => {
    const key = item.placeId ? `place:${item.placeId}:${item.contextKey}` : `id:${item.id}`;
    try {
      await fetch('/api/user/monitor-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryKey: key }),
      });
      setCheckedIn(prev => new Set([...prev, item.id]));
    } catch {
      // silently ignore — non-critical
    }
  }, []);

  const dueItems = items.filter(i => i.dueNow);
  const otherItems = items.filter(i => !i.dueNow);

  const priorityItems = otherItems.filter(i => i.monitorStatus === 'priority');
  const activeItems = otherItems.filter(i => i.monitorStatus === 'active');
  const candidateItems = otherItems.filter(i => i.monitorStatus === 'candidate');

  const totalDue = dueItems.length;
  const totalWatching = items.length;

  return (
    <main className="page watching-page">
      <div className="page-header">
        <div className="watching-header-top">
          <h1 className="watching-title">Watching</h1>
          <div className="watching-header-counts">
            {totalDue > 0 && (
              <span className="watching-due-badge">{totalDue} due</span>
            )}
            <span className="watching-total">{totalWatching} total</span>
          </div>
        </div>
        <p className="watching-subtitle">
          Places worth keeping an eye on — significance-triggered, time-aware.
        </p>
      </div>

      {items.length === 0 && (
        <div className="watching-empty">
          <p>No places in your monitoring queue yet.</p>
          <p className="watching-empty-hint">
            Save a place, add it to an active trip, or let it resurface across multiple sources — Compass will start watching it automatically.
          </p>
        </div>
      )}

      {dueItems.length > 0 && (
        <section className="watch-section">
          <h2 className="watch-section-title">
            🔴 Due now
            <span className="watch-section-count">{dueItems.length}</span>
          </h2>
          <div className="watch-list">
            {dueItems.map(item => (
              <WatchRow
                key={item.id}
                item={{ ...item, checkedIn: checkedIn.has(item.id) }}
                onCheckin={handleCheckin}
              />
            ))}
          </div>
        </section>
      )}

      {priorityItems.length > 0 && (
        <section className="watch-section">
          <h2 className="watch-section-title">
            🟠 Priority
            <span className="watch-section-count">{priorityItems.length}</span>
          </h2>
          <div className="watch-list">
            {priorityItems.map(item => (
              <WatchRow
                key={item.id}
                item={{ ...item, checkedIn: checkedIn.has(item.id) }}
                onCheckin={handleCheckin}
              />
            ))}
          </div>
        </section>
      )}

      {activeItems.length > 0 && (
        <section className="watch-section">
          <h2 className="watch-section-title">
            🟡 Active
            <span className="watch-section-count">{activeItems.length}</span>
          </h2>
          <div className="watch-list">
            {activeItems.map(item => (
              <WatchRow
                key={item.id}
                item={{ ...item, checkedIn: checkedIn.has(item.id) }}
                onCheckin={handleCheckin}
              />
            ))}
          </div>
        </section>
      )}

      {candidateItems.length > 0 && (
        <section className="watch-section">
          <h2 className="watch-section-title">
            🟣 Candidates
            <span className="watch-section-count">{candidateItems.length}</span>
          </h2>
          <div className="watch-list">
            {candidateItems.map(item => (
              <WatchRow
                key={item.id}
                item={{ ...item, checkedIn: checkedIn.has(item.id) }}
                onCheckin={handleCheckin}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
