'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { Context } from '../_lib/types';
import { getContextCounts } from '../_lib/triage';
import Twemoji from './Twemoji';

interface ReviewHubSignal {
  placeId: string;
  contextKey: string;
  contextLabel: string;
  name: string;
  label: string;
  significanceLevel: 'critical' | 'notable' | 'routine' | 'noise';
  lastObservedAt?: string;
}

interface ReviewHubClientProps {
  userId: string;
  contexts: Context[];
  archivedContexts?: Context[];
  discoveryCounts?: Record<string, number>;
  signalCounts?: Record<string, number>;
  recentSignals?: ReviewHubSignal[];
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

export default function ReviewHubClient({
  userId,
  contexts,
  archivedContexts = [],
  discoveryCounts = {},
  signalCounts = {},
  recentSignals = [],
}: ReviewHubClientProps) {
  const [counts, setCounts] = useState<Record<string, { saved: number; dismissed: number; resurfaced: number }>>({});
  const [showArchived, setShowArchived] = useState(false);

  const allKeys = [...contexts, ...archivedContexts].map(c => c.key).join(',');

  const refresh = useCallback(() => {
    const allCtxs = [...contexts, ...archivedContexts];
    const c: Record<string, { saved: number; dismissed: number; resurfaced: number }> = {};
    for (const ctx of allCtxs) {
      c[ctx.key] = getContextCounts(userId, ctx.key);
    }
    setCounts(c);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, allKeys]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, [refresh]);

  return (
    <main className="page">
      <div className="page-header">
        <h1>Review</h1>
        <p className="text-muted">Manage your triage decisions across all contexts.</p>
      </div>

      {recentSignals.length > 0 && (
        <section className="review-hub-signals card">
          <div className="card-body">
            <div className="review-signals-strip-header">
              <div>
                <p className="monitoring-note-kicker">Monitoring signals</p>
                <h2>Fresh changes across your review queues</h2>
              </div>
              <span className="badge badge-muted">{recentSignals.length} recent</span>
            </div>
            <div className="review-signals-pill-list">
              {recentSignals.map((signal) => (
                <Link
                  key={`${signal.contextKey}:${signal.placeId}`}
                  href={`/placecards/${signal.placeId}?context=${encodeURIComponent(signal.contextKey)}`}
                  className="review-signals-pill"
                >
                  <span className="review-signals-pill-name">{signal.name}</span>
                  <span className="text-xs text-muted">{signal.contextLabel}</span>
                  <span className={`hot-place-card-signal hot-place-card-signal-${signal.significanceLevel}`}>
                    {signal.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="review-hub-list">
        {contexts.map(ctx => {
          const c = counts[ctx.key] ?? { saved: 0, dismissed: 0, resurfaced: 0 };
          const signalCount = signalCounts[ctx.key] ?? 0;
          return (
            <Link
              key={ctx.key}
              href={`/review/${encodeURIComponent(ctx.key)}`}
              className="review-hub-card card"
            >
              <div className="card-body">
                <div className="flex items-center justify-between gap-sm">
                  <div>
                    <h3><Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size="md" /> {ctx.label}</h3>
                    {ctx.dates && <span className="text-xs text-muted">{ctx.dates}</span>}
                  </div>
                  <div className="review-counts">
                    {signalCount > 0 && <span className="badge badge-info">⚡ {signalCount} signals</span>}
                    {c.saved > 0 && <span className="badge badge-success">✓ {c.saved}</span>}
                    {c.dismissed > 0 && <span className="badge badge-danger">✗ {c.dismissed}</span>}
                    {c.resurfaced > 0 && <span className="badge badge-warning">↻ {c.resurfaced}</span>}
                    {c.saved === 0 && c.dismissed === 0 && c.resurfaced === 0 && (discoveryCounts[ctx.key] || 0) > 0 && (
                      <span className="badge badge-muted">{discoveryCounts[ctx.key]} to review</span>
                    )}
                  </div>
                </div>
                {signalCount > 0 && (
                  <p className="review-hub-signal-note">
                    {signalCount} place{signalCount === 1 ? '' : 's'} with fresh monitoring worth checking first.
                  </p>
                )}
              </div>
            </Link>
          );
        })}

        {contexts.length === 0 && (
          <div className="empty-state">
            <p className="text-muted">No contexts to review.</p>
          </div>
        )}
      </div>

      {archivedContexts.length > 0 && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <button
            className="filter-clear"
            onClick={() => setShowArchived(!showArchived)}
            style={{ marginBottom: 'var(--space-md)' }}
          >
            {showArchived ? 'Hide' : 'Show'} archived ({archivedContexts.length})
          </button>

          {showArchived && (
            <div className="review-hub-list">
              {archivedContexts.map(ctx => {
                const c = counts[ctx.key] ?? { saved: 0, dismissed: 0, resurfaced: 0 };
                const signalCount = signalCounts[ctx.key] ?? 0;
                return (
                  <Link
                    key={ctx.key}
                    href={`/review/${encodeURIComponent(ctx.key)}`}
                    className="review-hub-card card"
                    style={{ opacity: 0.7 }}
                  >
                    <div className="card-body">
                      <div className="flex items-center justify-between gap-sm">
                        <div>
                          <h3><Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size="md" /> {ctx.label}</h3>
                          <span className="status-badge status-archived">Archived</span>
                          {ctx.dates && <span className="text-xs text-muted" style={{ marginLeft: '8px' }}>{ctx.dates}</span>}
                        </div>
                        <div className="review-counts">
                          {signalCount > 0 && <span className="badge badge-info">⚡ {signalCount} signals</span>}
                          {c.saved > 0 && <span className="badge badge-success">✓ {c.saved}</span>}
                          {c.dismissed > 0 && <span className="badge badge-danger">✗ {c.dismissed}</span>}
                        </div>
                      </div>
                      {signalCount > 0 && (
                        <p className="review-hub-signal-note">
                          {signalCount} place{signalCount === 1 ? '' : 's'} still have fresh monitoring signals.
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
