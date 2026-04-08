'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Context, Discovery } from '../_lib/types';
import { getContextCounts } from '../_lib/triage';
import PlaceGrid from './PlaceGrid';
import BriefingBanner from './BriefingBanner';
import Twemoji from './Twemoji';
import TripPlanningWidget from './TripPlanningWidget';
import ContextSwitcher from './ContextSwitcher';

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
  detectedChanges?: string[];
  significanceLevel?: string;
  significanceSummary?: string;
  observationCount?: number;
}

interface DigestItemProp {
  entryId: string;
  name: string;
  city: string;
  monitorType: string;
  contextKey: string;
  significanceLevel: string;
  significanceSummary: string;
  changes: string[];
  stateContext?: {
    rating?: number;
    previousRating?: number;
    operationalStatus?: string;
    previousOperationalStatus?: string;
  };
  placeId?: string;
}

interface HomeClientProps {
  userId: string;
  contexts: Context[];
  discoveryMap: Record<string, Discovery[]>;
  contextMeta?: Record<string, { travel?: unknown; accommodation?: unknown; bookingStatus?: string }>;
  monitoringQueue?: MonitoringQueueItem[];
  digestTeaser?: string | null;
  digestItems?: DigestItemProp[];
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

/**
 * Format dates naturally.
 */
function formatDateNatural(dates: string | undefined): string | null {
  if (!dates) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const parenMatch = dates.match(/\(([^)]+)\)/);
  const note = parenMatch ? parenMatch[1] : null;
  const cleaned = dates.replace(/\s*\([^)]*\)/, '').trim();

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

  const rangeAcross = cleaned.match(/^(\w+)\s+(\d+)\s*[--]\s*(\w+)\s+(\d+),?\s+(\d{4})$/);
  if (rangeAcross) {
    const [, m1, d1, m2, d2, year] = rangeAcross;
    const yr = parseInt(year ?? '0');
    const yearSuffix = yr !== currentYear ? `, ${year}` : '';
    return `${m1} ${d1} - ${m2} ${d2}${yearSuffix}`;
  }

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

const CHANGE_LABELS: Record<string, string> = {
  'rating-down': 'Rating dropped',
  'rating-up': 'Rating improved',
  'closure-signal': 'Closure detected',
  'operational-change': 'Status changed',
  'price-changed': 'Price shifted',
  'description-changed': 'Description rewritten',
  'review-count-up': 'More reviews',
  'review-count-down': 'Reviews disappeared',
  'availability-changed': 'Availability changed',
  'construction-signal': 'Construction progress',
  'sentiment-shift': 'Sentiment shifted',
  'hours-changed': 'Hours updated',
  'general-update': 'Updated',
};

function formatChangeKinds(changes: string[]): string {
  if (changes.length === 0) return '';
  const primary = CHANGE_LABELS[changes[0] ?? ''] ?? 'Change detected';
  if (changes.length === 1) return primary;
  return `${primary} +${changes.length - 1}`;
}

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
                {/* explanation hidden in tray — shown in full /watching page */}
              </span>
              <span className={`monitoring-tray-status monitoring-tray-status-${item.monitorStatus}`}>
                {item.dueNow ? 'Due now' : STATUS_LABEL[item.monitorStatus] ?? item.monitorStatus}
              </span>
              {item.detectedChanges && item.detectedChanges.length > 0 && (
                <span className={`monitoring-tray-changes monitoring-tray-sig-${item.significanceLevel ?? 'noise'}`}>
                  {item.significanceSummary ?? formatChangeKinds(item.detectedChanges)}
                </span>
              )}
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
  digestTeaser,
  digestItems = [],
}: HomeClientProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [contextCounts, setContextCounts] = useState<Record<string, { saved: number; dismissed: number; resurfaced: number }>>({});
  const [emergingKeys, setEmergingKeys] = useState<Set<string>>(new Set());
  const [attachingAttrs, setAttachingAttrs] = useState<Record<string, Array<{ field: string; value: string }>>>({});
  const [, setTriageVersion] = useState(0);

  // Active context key — persisted in localStorage
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Initialize active key from localStorage on first mount;
  // on subsequent context refreshes, keep current key if still valid.
  useEffect(() => {
    setMounted(true);
    // Load all context counts
    const counts: Record<string, { saved: number; dismissed: number; resurfaced: number }> = {};
    for (const ctx of contexts) {
      counts[ctx.key] = getContextCounts(userId, ctx.key);
    }
    setContextCounts(counts);

    if (!initializedRef.current) {
      // First mount: restore from localStorage
      initializedRef.current = true;
      try {
        const stored = localStorage.getItem('compass-active-context');
        if (stored && contexts.some(c => c.key === stored)) {
          setActiveKey(stored);
        } else if (contexts.length > 0) {
          setActiveKey(contexts[0]!.key);
        }
      } catch {
        if (contexts.length > 0) setActiveKey(contexts[0]!.key);
      }
    } else {
      // Subsequent context refreshes (e.g. after router.refresh()):
      // keep the current activeKey if it's still valid, otherwise fall back
      setActiveKey(prev => {
        if (prev && contexts.some(c => c.key === prev)) return prev;
        return contexts.length > 0 ? contexts[0]!.key : null;
      });
    }
  }, [userId, contexts]);

  // Persist active key
  useEffect(() => {
    if (!activeKey) return;
    try {
      localStorage.setItem('compass-active-context', activeKey);
    } catch { /* ignore */ }
  }, [activeKey]);

  // Broadcast active context to chat widget
  const broadcastActiveContext = useCallback((key: string) => {
    window.dispatchEvent(new CustomEvent('compass-context-switched', {
      detail: { key },
    }));
  }, []);

  const handleContextSelect = useCallback((key: string) => {
    setActiveKey(key);
    broadcastActiveContext(key);
  }, [broadcastActiveContext]);

  // Listen for chat-driven context switches
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail?.key) return;
      // If the context exists, switch to it
      if (contexts.some(c => c.key === detail.key)) {
        setActiveKey(detail.key);
      }
    };
    window.addEventListener('compass-chat-context-switch', handler);
    return () => window.removeEventListener('compass-chat-context-switch', handler);
  }, [contexts]);

  // Triage change listener
  useEffect(() => {
    const handler = () => setTriageVersion((v) => v + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  // Listen for new trip creation from chat
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
      // Switch to the newly created context
      setActiveKey(detail.key);
      broadcastActiveContext(detail.key);
      // Refresh server data to load the new context
      router.refresh();
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
  }, [router, broadcastActiveContext]);

  // Listen for trip attribute attachments from chat
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; attributes: Array<{ field: string; value: string }> }>).detail;
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

  // Refresh data when chat mutates
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

  // Broadcast initial context on mount
  useEffect(() => {
    if (activeKey) {
      broadcastActiveContext(activeKey);
    }
  }, [activeKey, broadcastActiveContext]);

  if (contexts.length === 0) {
    return (
      <main className="page focused-page">
        <div className="focused-header">
          <h1>🧭 Compass</h1>
          <p className="compass-tagline">Your AI travel concierge</p>
        </div>
        <div className="focused-empty">
          <div className="focused-empty-icon">🌍</div>
          <h2>Where to next?</h2>
          <p>Start planning by chatting below — tell me about a trip, a dinner out, or a neighbourhood to explore.</p>
        </div>
      </main>
    );
  }

  const ctx = contexts.find(c => c.key === activeKey) || contexts[0]!;
  const discoveries = discoveryMap[ctx.key] ?? [];
  const counts = mounted ? (contextCounts[ctx.key] ?? { saved: 0, dismissed: 0, resurfaced: 0 }) : { saved: 0, dismissed: 0, resurfaced: 0 };
  const naturalDate = formatDateNatural(ctx.dates);
  const description = buildDescription(ctx);
  const isEmerging = emergingKeys.has(ctx.key);
  const landingAttrs = attachingAttrs[ctx.key] ?? [];

  return (
    <main className="page focused-page">
      {/* Header with context switcher */}
      <div className="focused-header">
        <div className="focused-header-top">
          <h1 className="focused-brand">🧭</h1>
          <ContextSwitcher
            contexts={contexts.map(c => ({
              key: c.key,
              label: c.label,
              emoji: c.emoji,
              type: c.type,
              dates: c.dates,
            }))}
            activeKey={activeKey}
            onSelect={handleContextSelect}
          />
        </div>
      </div>

      {/* Focused context content */}
      <div className={`focused-content${isEmerging ? ' section-emerging' : ''}`}>
        {/* Context hero */}
        <div className={`focused-hero${ctx.type === 'trip' ? ' focused-hero-trip' : ''}`}>
          <div className="focused-hero-left">
            <span className="focused-hero-emoji">
              <Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size={ctx.type === 'trip' ? 'xl' : 'lg'} />
            </span>
            <div className="focused-hero-text">
              <h2 className={`focused-hero-title${ctx.type === 'trip' ? ' focused-hero-title-trip' : ''}`}>{ctx.label}</h2>
              <div className="focused-hero-meta">
                {naturalDate && (
                  <span className={`section-date${ctx.type === 'trip' ? ' section-date-trip' : ''}`}>{naturalDate}</span>
                )}
                {naturalDate && description && ctx.type !== 'trip' && (
                  <span className="section-meta-sep">·</span>
                )}
                {description && ctx.type !== 'trip' && (
                  <span className="section-desc">{description}</span>
                )}
              </div>
              {description && ctx.type === 'trip' && (
                <div className="section-desc-trip">{description}</div>
              )}
              {landingAttrs.length > 0 && (
                <div className="section-attr-pills">
                  {landingAttrs.map(attr => (
                    <span key={attr.field} className="section-attr-pill">
                      {attr.field === 'dates' ? '📅' : attr.field === 'city' ? '📍' : '🏷'} {attr.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="focused-hero-right">
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

        {/* Trip planning widget */}
        {ctx.type === 'trip' && (() => {
          const raw = ctx as unknown as Record<string, unknown>;
          return (
            <div className="focused-trip-widget">
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
          );
        })()}

        <BriefingBanner userId={userId} />

        {/* Significance digest banner — shows when monitored places have recent notable changes */}
        {digestTeaser && digestItems.length > 0 && (
          <div className="digest-banner">
            <div className="digest-banner-teaser">{digestTeaser}</div>
            <ul className="digest-banner-list">
              {digestItems.slice(0, 3).map(item => {
                const href = `/placecards/${item.placeId || item.entryId}?context=${encodeURIComponent(item.contextKey)}`;
                return (
                  <li key={item.entryId} className={`digest-banner-item digest-banner-sig-${item.significanceLevel}`}>
                    <Link href={href} className="digest-banner-name">{item.name}</Link>
                    <span className="digest-banner-detail">
                      {item.stateContext?.previousRating !== undefined && item.stateContext?.rating !== undefined
                        ? `${item.stateContext.previousRating} \u2192 ${item.stateContext.rating}`
                        : item.significanceSummary}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <MonitoringQueueTray items={monitoringQueue.filter(i => i.contextKey === ctx.key)} />

        {/* Discoveries */}
        {discoveries.length > 0 ? (
          <PlaceGrid
            discoveries={discoveries}
            contextKey={ctx.key}
            contextLabel={ctx.label}
            contextEmoji={ctx.emoji}
            contextType={ctx.type}
            userId={userId}
            layout="carousel"
          />
        ) : (
          <div className="focused-empty-discoveries">
            <p className="focused-empty-title">No discoveries yet</p>
            <p className="focused-empty-hint">Try asking:</p>
            <div className="focused-empty-prompts">
              {ctx.city ? (
                <>
                  <span className="focused-empty-prompt">📍 Find great restaurants in {ctx.city}</span>
                  <span className="focused-empty-prompt">🎨 What are the must-see galleries in {ctx.city}?</span>
                  <span className="focused-empty-prompt">🎵 Best jazz bars in {ctx.city}</span>
                </>
              ) : (
                <>
                  <span className="focused-empty-prompt">📍 Find restaurants for my trip</span>
                  <span className="focused-empty-prompt">🎨 What are the must-see spots?</span>
                  <span className="focused-empty-prompt">🎵 Best live music venues?</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
