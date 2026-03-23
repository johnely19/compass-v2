'use client';

import Link from 'next/link';
import type { Context, Discovery } from '../_lib/types';
import PlaceGrid from './PlaceGrid';

interface HomeClientProps {
  userId: string;
  contexts: Context[];
  discoveryMap: Record<string, Discovery[]>;
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

export default function HomeClient({
  userId,
  contexts,
  discoveryMap,
}: HomeClientProps) {
  if (contexts.length === 0) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🧭 Compass</h1>
          <p>No active contexts yet. Chat with the concierge to set up your first trip, outing, or radar.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>🧭 Compass</h1>
        <p>Your discovery inbox — what needs your attention.</p>
      </div>

      {contexts.map(ctx => {
        const discoveries = discoveryMap[ctx.key] ?? [];

        return (
          <section key={ctx.key} className="section">
            <div className="section-header">
              <div>
                <h2>
                  {ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} {ctx.label}
                </h2>
                {ctx.dates && (
                  <span className="text-xs text-muted">{ctx.dates}</span>
                )}
              </div>
              <Link
                href={`/review/${encodeURIComponent(ctx.key)}`}
                className="text-sm"
              >
                Review all →
              </Link>
            </div>

            {discoveries.length > 0 ? (
              <PlaceGrid
                discoveries={discoveries}
                contextKey={ctx.key}
                userId={userId}
              />
            ) : (
              <div className="empty-state">
                <p className="text-muted text-sm">
                  No discoveries yet — keep chatting and we&apos;ll research for you.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
