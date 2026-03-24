'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Context, Discovery } from '../_lib/types';
import { getContextCounts } from '../_lib/triage';
import PlaceGrid from './PlaceGrid';
import BriefingBanner from './BriefingBanner';
import Twemoji from './Twemoji';
import TripPlanningWidget from './TripPlanningWidget';

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

/**
 * Format dates naturally.
 * "April 27-30, 2026" → "April 27 – 30"
 * "July 2026 (3+ weeks)" → "This July · 3+ weeks"
 * "April 27-30, 2026" (if current year) → "April 27 – 30"
 */
function formatDateNatural(dates: string | undefined): string | null {
  if (!dates) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Extract parenthetical note (e.g. "(3+ weeks)")
  const parenMatch = dates.match(/\(([^)]+)\)/);
  const note = parenMatch ? parenMatch[1] : null;
  const cleaned = dates.replace(/\s*\([^)]*\)/, '').trim();

  // "April 27-30, 2026"
  const rangeInMonth = cleaned.match(/^(\w+)\s+(\d+)\s*[-–]\s*(\d+),?\s+(\d{4})$/);
  if (rangeInMonth) {
    const [, month, startDay, endDay, year] = rangeInMonth;
    const yr = parseInt(year ?? '0');
    const monthIdx = months.findIndex(m => m.startsWith(month ?? ''));
    let prefix = '';
    if (yr === currentYear && monthIdx === currentMonth) prefix = 'This month · ';
    else if (yr === currentYear && monthIdx === currentMonth + 1) prefix = 'Next month · ';
    const yearSuffix = yr !== currentYear ? `, ${year}` : '';
    return `${prefix}${month} ${startDay} – ${endDay}${yearSuffix}`;
  }

  // "April 27 - May 2, 2026"
  const rangeAcross = cleaned.match(/^(\w+)\s+(\d+)\s*[-–]\s*(\w+)\s+(\d+),?\s+(\d{4})$/);
  if (rangeAcross) {
    const [, m1, d1, m2, d2, year] = rangeAcross;
    const yr = parseInt(year ?? '0');
    const yearSuffix = yr !== currentYear ? `, ${year}` : '';
    return `${m1} ${d1} – ${m2} ${d2}${yearSuffix}`;
  }

  // "July 2026"
  const monthYear = cleaned.match(/^(\w+)\s+(\d{4})$/);
  if (monthYear) {
    const [, month, year] = monthYear;
    const yr = parseInt(year ?? '0');
    const monthIdx = months.findIndex(m => m.startsWith(month ?? ''));
    let result = '';
    if (yr === currentYear && monthIdx === currentMonth) result = 'This month';
    else if (yr === currentYear && monthIdx === currentMonth + 1) result = 'Next month';
    else if (yr === currentYear) result = `This ${month}`;
    else result = `${month} ${year}`;
    if (note) result += ` · ${note}`;
    return result;
  }

  // Fallback: return as-is but strip year if current
  const withoutYear = cleaned.replace(new RegExp(`,?\\s*${currentYear}`), '');
  return note ? `${withoutYear} · ${note}` : withoutYear;
}

/**
 * Build a short description from context focus areas.
 */
function buildDescription(ctx: Context): string | null {
  if (ctx.focus && ctx.focus.length > 0) {
    return ctx.focus.slice(0, 5).join(' · ');
  }
  return null;
}

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

  // Re-render when triage state changes (for saved count badges)
  const [, setTriageVersion] = useState(0);
  useEffect(() => {
    const handler = () => setTriageVersion((v) => v + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  return (
    <main className="page">
      <div className="page-header">
        <h1>🧭 Compass</h1>
        <p>Your discovery inbox — what needs your attention.</p>
      </div>

      <BriefingBanner userId={userId} />

      {contexts.map(ctx => {
        const discoveries = discoveryMap[ctx.key] ?? [];
        const counts = getContextCounts(userId, ctx.key);
        const naturalDate = formatDateNatural(ctx.dates);
        const description = buildDescription(ctx);

        return (
          <section key={ctx.key} className="section">
            <div className="section-header">
              <div className="section-header-left">
                <div className="section-title-row">
                  <span className="section-emoji-large">
                    <Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size="lg" />
                  </span>
                  <div className="section-title-text">
                    <h2>{ctx.label}</h2>
                    <div className="section-meta">
                      {naturalDate && (
                        <span className="section-date">{naturalDate}</span>
                      )}
                      {naturalDate && description && (
                        <span className="section-meta-sep">·</span>
                      )}
                      {description && (
                        <span className="section-desc">{description}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="section-header-right">
                {counts.saved > 0 && (
                  <Link
                    href={`/review/${encodeURIComponent(ctx.key)}?tab=saved`}
                    className="saved-count-badge"
                  >
                    ✓ {counts.saved} saved
                  </Link>
                )}
                <Link
                  href={`/review/${encodeURIComponent(ctx.key)}`}
                  className="section-review-link"
                >
                  Review →
                </Link>
              </div>
            </div>

            {ctx.type === 'trip' && (
              <TripPlanningWidget userId={userId} contextKey={ctx.key} />
            )}

            {discoveries.length > 0 ? (
              <PlaceGrid
                discoveries={discoveries}
                contextKey={ctx.key}
                userId={userId}
                layout="carousel"
              />
            ) : (
              <div className="empty-state">
                <p className="text-muted text-sm">
                  No discoveries yet — the radar is scanning.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
