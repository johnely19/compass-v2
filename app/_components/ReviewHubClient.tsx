'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { Context } from '../_lib/types';
import { getContextCounts } from '../_lib/triage';

interface ReviewHubClientProps {
  userId: string;
  contexts: Context[];
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

export default function ReviewHubClient({ userId, contexts }: ReviewHubClientProps) {
  const [counts, setCounts] = useState<Record<string, { saved: number; dismissed: number; resurfaced: number }>>({});

  const refresh = useCallback(() => {
    const c: typeof counts = {};
    for (const ctx of contexts) {
      c[ctx.key] = getContextCounts(userId, ctx.key);
    }
    setCounts(c);
  }, [userId, contexts]);

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

      <div className="review-hub-list">
        {contexts.map(ctx => {
          const c = counts[ctx.key] ?? { saved: 0, dismissed: 0, resurfaced: 0 };
          return (
            <Link
              key={ctx.key}
              href={`/review/${encodeURIComponent(ctx.key)}`}
              className="review-hub-card card"
            >
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <div>
                    <h3>{ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} {ctx.label}</h3>
                    {ctx.dates && <span className="text-xs text-muted">{ctx.dates}</span>}
                  </div>
                  <div className="review-counts">
                    {c.saved > 0 && <span className="badge badge-success">✓ {c.saved}</span>}
                    {c.dismissed > 0 && <span className="badge badge-danger">✗ {c.dismissed}</span>}
                    {c.resurfaced > 0 && <span className="badge badge-warning">↻ {c.resurfaced}</span>}
                  </div>
                </div>
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
    </main>
  );
}
