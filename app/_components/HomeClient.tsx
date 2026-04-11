'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type TripAttributeEvent } from '../_lib/chat/emergence';
import type { Context, Discovery } from '../_lib/types';
import { getContextCounts } from '../_lib/triage';
import PlaceGrid from './PlaceGrid';
import BriefingBanner from './BriefingBanner';
import Twemoji from './Twemoji';
import TripPlanningWidget from './TripPlanningWidget';

interface MonitoringQueueItem {
  id: string;
  name: string;
  city: string;
  type: string;
  contextKey: string;
  monitorStatus: string;
  monitorType: string;
  monitorCadence?: string;
  monitorExplanation?: string;
  dueNow: boolean;
  placeId?: string;
}

interface HomeClientProps {
  userId: string;
  contexts: Context[];
  discoveryMap: Record<string, Discovery[]>;
  contextMeta?: Record<string, { travel?: unknown; accommodation?: unknown; bookingStatus?: string }>;
  monitoringQueue?: MonitoringQueueItem[];
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

/**
 * Format dates naturally.
 * "April 27-30, 2026" → "April 27 - 30"
 * "July 2026 (3+ weeks)" → "This July · 3+ weeks"
 * "April 27-30, 2026" (if current year) → "April 27 - 30"
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

  // ISO: "2026-04-27 to 2026-04-30"
  const isoRange = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+to\s+(\d{4})-(\d{2})-(\d{2})$/);
  if (isoRange) {
    const [, , startMo, startDay, endYr, endMo, endDay] = isoRange;
    const startDate = new Date(`${isoRange[1]}-${startMo}-${startDay}`);
    const endDate = new Date(`${endYr}-${endMo}-${endDay}`);
    const sMonth = startDate.toLocaleString('en-US', { month: 'long' });
    const eMonth = endDate.toLocaleString('en-US', { month: 'long' });
    const yr = parseInt(endYr ?? '0');
    const yearSuffix = yr !== currentYear ? `, ${endYr}` : '';
    if (sMonth === eMonth) {
      return `${sMonth} ${parseInt(startDay ?? '0')} - ${parseInt(endDay ?? '0')}${yearSuffix}`;
    }
    return `${sMonth} ${parseInt(startDay ?? '0')} - ${eMonth} ${parseInt(endDay ?? '0')}${yearSuffix}`;
  }

  // "April 27-30, 2026"
  const rangeInMonth = cleaned.match(/^(\w+)\s+(\d+)\s*[--]\s*(\d+),?\s+(\d{4})$/);
  if (rangeInMonth) {
    const [, month, startDay, endDay, year] = rangeInMonth;
    const yr = parseInt(year ?? '0');
    const monthIdx = months.findIndex(m => m.startsWith(month ?? ''));
    let prefix = '';
    if (yr === currentYear && monthIdx === currentMonth) prefix = 'This month · ';
    else if (yr === currentYear && monthIdx === currentMonth + 1) prefix = 'Next month · ';
    const yearSuffix = yr !== currentYear ? `, ${year}` : '';
    return `${prefix}${month} ${startDay} - ${endDay}${yearSuffix}`;
  }

  // "April 27 - May 2, 2026"
  const rangeAcross = cleaned.match(/^(\w+)\s+(\d+)\s*[--]\s*(\w+)\s+(\d+),?\s+(\d{4})$/);
  if (rangeAcross) {
    const [, m1, d1, m2, d2, year] = rangeAcross;
    const yr = parseInt(year ?? '0');
    const yearSuffix = yr !== currentYear ? `, ${year}` : '';
    return `${m1} ${d1} - ${m2} ${d2}${yearSuffix}`;
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

const STATUS_LABEL: Record<string, string> = {
  candidate: 'Candidate',
  active: 'Active',
  priority: 'Priority',
};

const TYPE_MONITOR_ICON: Record<string, string> = {
  hospitality: '🍽',
  stay: '🏨',
  development: '🏗',
  culture: '🎭',
  general: '📍',
};

function MonitoringQueueTray({ items }: { items: MonitoringQueueItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const dueItems = items.filter(i => i.dueNow);
  const otherItems = items.filter(i => !i.dueNow);
  const shown = expanded ? items : items.slice(0, 3);
  const hasDue = dueItems.length > 0;

  return (
    <div className={`monitoring-tray${hasDue ? ' monitoring-tray-has-due' : ''}`}>
      <div className="monitoring-tray-header">
        <span className="monitoring-tray-kicker">
          {hasDue ? '🔴' : '🟡'} Monitoring Queue
        </span>
        <span className="monitoring-tray-counts">
          {hasDue && <span className="monitoring-tray-due-badge">{dueItems.length} due</span>}
          {otherItems.length > 0 && <span className="monitoring-tray-other-count">{otherItems.length} watching</span>}
        </span>
      </div>
      <ul className="monitoring-tray-list">
        {shown.map(item => {
          const href = `/placecards/${item.placeId || item.id}?context=${encodeURIComponent(item.contextKey)}`;
          return (
            <li key={`${item.contextKey}:${item.id}`} className={`monitoring-tray-item${item.dueNow ? ' monitoring-tray-item-due' : ''}`}>
              <span className="monitoring-tray-icon">{TYPE_MONITOR_ICON[item.monitorType] ?? '📍'}</span>
              <span className="monitoring-tray-item-body">
                <Link href={href} className="monitoring-tray-name">{item.name}</Link>
                <span className="monitoring-tray-meta">{item.city}</span>
                {item.monitorExplanation && <span className="monitoring-tray-reason">{item.monitorExplanation}</span>}
              </span>
              <span className={`monitoring-tray-status monitoring-tray-status-${item.monitorStatus}`}>
                {item.dueNow ? 'Due now' : STATUS_LABEL[item.monitorStatus] ?? item.monitorStatus}
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > 3 && (
        <button className="monitoring-tray-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show less' : `Show ${items.length - 3} more`}
        </button>
      )}
    </div>
  );
}

export default function HomeClient({
  userId,
  contexts,
  discoveryMap,
  contextMeta = {},
  monitoringQueue = [],
}: HomeClientProps) {
  const router = useRouter();
  // Mounted state to avoid hydration mismatch from localStorage reads
  const [mounted, setMounted] = useState(false);
  // Store context counts - initialize with zeros to match server render
  const [contextCounts, setContextCounts] = useState<Record<string, { saved: number; dismissed: number; resurfaced: number }>>({}); 
  // Keys that are currently "emerging" (just created from chat) — gets entrance animation
  const [emergingKeys, setEmergingKeys] = useState<Set<string>>(new Set());
  // Map of context key → recently-attached attribute pills
  const [attachingAttrs, setAttachingAttrs] = useState<Record<string, TripAttributeEvent[]>>({});

  // Re-render when triage state changes (for saved count badges)
  // Must be BEFORE any conditional returns (Rules of Hooks)
  const [, setTriageVersion] = useState(0);
  useEffect(() => {
    const handler = () => setTriageVersion((v) => v + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  // Listen for new trip creation from chat and mark the key as emerging
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail?.key) return;
      setEmergingKeys(prev => {
        const next = new Set(prev);
        next.add(detail.key);
        return next;
      });
      // Remove the emerging flag after the animation completes (700ms animation + buffer)
      const timer = setTimeout(() => {
        setEmergingKeys(prev => {
          const next = new Set(prev);
          next.delete(detail.key);
          return next;
        });
      }, 1200);
      timers.push(timer);
    };
    window.addEventListener('compass-trip-created', handler);
    return () => {
      window.removeEventListener('compass-trip-created', handler);
      timers.forEach(clearTimeout);
    };
  }, []);

  // Listen for trip attribute attachments from chat
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; attributes: TripAttributeEvent[] }>).detail;
      if (!detail?.key || !detail.attributes?.length) return;
      setAttachingAttrs(prev => ({
        ...prev,
        [detail.key]: detail.attributes,
      }));
      // Clear attribute pills after animation
      const timer = setTimeout(() => {
        setAttachingAttrs(prev => {
          const next = { ...prev };
          delete next[detail.key];
          return next;
        });
      }, 2500);
      timers.push(timer);
    };
    window.addEventListener('compass-trip-attributes', handler);
    return () => {
      window.removeEventListener('compass-trip-attributes', handler);
      timers.forEach(clearTimeout);
    };
  }, []);

  // Refresh homepage immediately when chat or other client actions mutate Compass data.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        router.refresh();
      }, 120);
    };
    window.addEventListener('compass-data-changed', handler);
    return () => {
      window.removeEventListener('compass-data-changed', handler);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [router]);

  // Initialize from localStorage after mount
  useEffect(() => {
    setMounted(true);
    // Load all context counts
    const counts: Record<string, { saved: number; dismissed: number; resurfaced: number }> = {};
    for (const ctx of contexts) {
      counts[ctx.key] = getContextCounts(userId, ctx.key);
    }
    setContextCounts(counts);
  }, [userId, contexts]);

  // Triage hydration now handled by <TriageHydrator> in root layout

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
      <div className="page-header compass-header">
        <h1>🧭 Compass</h1>
        <p className="compass-tagline">The AI Travel Agent that ensures the best experience on your trips and outings</p>
      </div>

      <BriefingBanner userId={userId} />

      <MonitoringQueueTray items={monitoringQueue} />

      {contexts.map(ctx => {
        const discoveries = discoveryMap[ctx.key] ?? [];
        // Use stored counts after mount, or zeros before mount (matches server)
        const counts = mounted ? (contextCounts[ctx.key] ?? { saved: 0, dismissed: 0, resurfaced: 0 }) : { saved: 0, dismissed: 0, resurfaced: 0 };
        const naturalDate = formatDateNatural(ctx.dates);
        const description = buildDescription(ctx);

        const isEmerging = emergingKeys.has(ctx.key);
        const landingAttrs = attachingAttrs[ctx.key] ?? [];
        return (
          <section key={ctx.key} className={`section${isEmerging ? ' section-emerging' : ''}`}>
            <div className={`section-header${ctx.type === 'trip' ? ' section-header-trip' : ''}`}>
              <div className="section-header-left">
                <div className={`section-title-row${ctx.type === 'trip' ? ' section-title-row-trip' : ''}`}>
                  <span className={ctx.type === 'trip' ? 'section-emoji-trip' : 'section-emoji-large'}>
                    <Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size={ctx.type === 'trip' ? 'xl' : 'lg'} />
                  </span>
                  <div className="section-title-text">
                    <h2 className={ctx.type === 'trip' ? 'section-title-trip' : ''}>{ctx.label}</h2>
                    <div className="section-meta">
                      {naturalDate && (
                        <span className={`section-date${ctx.type === 'trip' ? ' section-date-trip' : ''}`}>{naturalDate}</span>
                      )}
                      {/* For non-trip: inline with separator */}
                      {naturalDate && description && ctx.type !== 'trip' && (
                        <span className="section-meta-sep">·</span>
                      )}
                      {description && ctx.type !== 'trip' && (
                        <span className="section-desc">{description}</span>
                      )}
                    </div>
                    {/* For trips: description on its own third line */}
                    {description && ctx.type === 'trip' && (
                      <div className="section-desc-trip">{description}</div>
                    )}
                    {/* Attribute pills — appear when chat attaches new trip attributes */}
                    {landingAttrs.length > 0 && (
                      <div className="section-attr-pills">
                        {landingAttrs.map(attr => (
                          <span key={`${attr.field}:${attr.value}`} className="section-attr-pill">
                            {attr.icon} {attr.label}: {attr.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Desktop: trip planning widget inline with header */}
              {ctx.type === 'trip' && (() => {
                const raw = ctx as unknown as Record<string, unknown>;
                return (
                <div className="section-header-trip-widget">
                  <TripPlanningWidget
                    userId={userId}
                    contextKey={ctx.key}
                    travel={contextMeta[ctx.key]?.travel as never}
                    accommodation={contextMeta[ctx.key]?.accommodation as never}
                    bookingStatus={contextMeta[ctx.key]?.bookingStatus}
                    savedCount={counts.saved}
                    purpose={raw.purpose as string | undefined}
                    people={raw.people as Array<{ name: string; relation?: string }> | undefined}
                  />
                </div>
                );})()}

              <div className="section-header-right">
                {ctx.type !== 'trip' && counts.saved > 0 && (
                  <Link
                    href={`/review/${encodeURIComponent(ctx.key)}?tab=saved`}
                    className="saved-count-badge"
                  >
                    ✓ {counts.saved} saved
                  </Link>
                )}
                {ctx.type !== 'trip' && (
                  <Link
                    href={`/review/${encodeURIComponent(ctx.key)}`}
                    className="section-review-link"
                  >
                    Review →
                  </Link>
                )}
              </div>
            </div>

            {/* Mobile: trip planning widget below header */}
            {ctx.type === 'trip' && (() => {
              const raw = ctx as unknown as Record<string, unknown>;
              return (
              <div className="section-trip-widget-mobile">
                <TripPlanningWidget
                  userId={userId}
                  contextKey={ctx.key}
                  travel={contextMeta[ctx.key]?.travel as never}
                  accommodation={contextMeta[ctx.key]?.accommodation as never}
                  bookingStatus={contextMeta[ctx.key]?.bookingStatus}
                  savedCount={counts.saved}
                  purpose={raw.purpose as string | undefined}
                  people={raw.people as Array<{ name: string; relation?: string }> | undefined}
                />
              </div>
              );})()}

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
                  No discoveries yet - the radar is scanning.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
