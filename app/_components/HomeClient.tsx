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
import { buildIntelligenceAttachmentChips, buildMonitoringActionPrompts, buildMonitoringPromptAttachmentChips, summarizeMonitoringActionPrompts } from '../_lib/trip-emergence';
import type { TripAttributeChip } from '../_lib/trip-emergence';

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
  // Sort: due first, then by significance level (critical > notable > routine > noise), then by observationCount
  const SIGNIFICANCE_RANK: Record<string, number> = { critical: 3, notable: 2, routine: 1, noise: 0 };
  const sorted = [...items].sort((a, b) => {
    if (a.dueNow !== b.dueNow) return a.dueNow ? -1 : 1;
    const sigDiff = (SIGNIFICANCE_RANK[b.significanceLevel ?? 'noise'] ?? 0) - (SIGNIFICANCE_RANK[a.significanceLevel ?? 'noise'] ?? 0);
    if (sigDiff !== 0) return sigDiff;
    return (b.observationCount ?? 0) - (a.observationCount ?? 0);
  });
  const shown = expanded ? sorted : sorted.slice(0, 3);
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
        {sorted.length > 3 && (
          <li className="monitoring-tray-count-note">{sorted.length} places watched in this context</li>
        )}
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
  const [attachingAttrs, setAttachingAttrs] = useState<Record<string, TripAttributeChip[]>>({});
  const [, setTriageVersion] = useState(0);
  const seenDigestEntryIdsRef = useRef<Record<string, string[]>>({});
  const digestHydratedContextsRef = useRef<Set<string>>(new Set());

  // Active context key — persisted in localStorage
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const initializedRef = useRef(false);
  // Target context key from chat that isn't (yet) in the `contexts` prop.
  // Applied the next time contexts update and the key becomes present.
  const pendingContextKeyRef = useRef<string | null>(null);

  /**
   * Apply a new active context key atomically.
   * - Updates React state
   * - Writes localStorage synchronously (so concurrent refresh-driven
   *   init effects never read a stale value)
   * - Clears any pending ref if the target is satisfied
   */
  const applyActiveKey = useCallback((key: string) => {
    setActiveKey(key);
    try { localStorage.setItem('compass-active-context', key); } catch { /* ignore */ }
    if (pendingContextKeyRef.current === key) {
      pendingContextKeyRef.current = null;
    }
  }, []);

  // Load triage counts whenever contexts change.
  useEffect(() => {
    setMounted(true);
    const counts: Record<string, { saved: number; dismissed: number; resurfaced: number }> = {};
    for (const ctx of contexts) {
      counts[ctx.key] = getContextCounts(userId, ctx.key);
    }
    setContextCounts(counts);
  }, [userId, contexts]);

  // Initialize active key from localStorage on FIRST mount only.
  // Later context refreshes must not clobber a chat-driven switch by
  // reading a possibly-stale localStorage value.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    try {
      const stored = localStorage.getItem('compass-active-context');
      if (stored) {
        setActiveKey(stored);
      } else if (contexts.length > 0) {
        setActiveKey(contexts[0]!.key);
      }
    } catch {
      if (contexts.length > 0) setActiveKey(contexts[0]!.key);
    }
    // Intentionally runs only once; subsequent switches go through
    // applyActiveKey / chat switch / trip-created handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defensive fallback: if activeKey ever becomes null (e.g. first
  // mount raced with contexts arriving), seed it from the first context.
  useEffect(() => {
    if (activeKey === null && contexts.length > 0) {
      setActiveKey(contexts[0]!.key);
    }
  }, [activeKey, contexts]);

  // When contexts update, apply any pending chat-driven target key that
  // is now available. This fixes the case where a chat switch arrives
  // before the newly-created trip reaches the homepage props.
  useEffect(() => {
    const pending = pendingContextKeyRef.current;
    if (!pending) return;
    if (contexts.some(c => c.key === pending)) {
      applyActiveKey(pending);
    }
  }, [contexts, applyActiveKey]);

  // Persist active key (belt-and-braces; applyActiveKey also writes
  // synchronously). Handles the initial-mount setActiveKey path.
  useEffect(() => {
    if (!activeKey) return;
    try {
      localStorage.setItem('compass-active-context', activeKey);
    } catch { /* ignore */ }
  }, [activeKey]);

  // Broadcast active context to chat widget (include label/emoji for scoped display)
  const broadcastActiveContext = useCallback((key: string) => {
    const ctx = contexts.find(c => c.key === key);
    window.dispatchEvent(new CustomEvent('compass-context-switched', {
      detail: {
        key,
        label: ctx?.label,
        emoji: ctx?.emoji || TYPE_EMOJI[ctx?.type ?? ''] || '📌',
        type: ctx?.type,
      },
    }));
  }, [contexts]);

  const handleContextSelect = useCallback((key: string) => {
    applyActiveKey(key);
    broadcastActiveContext(key);
  }, [applyActiveKey, broadcastActiveContext]);

  // Listen for chat-driven context switches.
  // If the target key is already in `contexts`, apply it immediately.
  // Otherwise stash it on pendingContextKeyRef so the next contexts
  // refresh can apply it instead of dropping the event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail?.key) return;
      if (contexts.some(c => c.key === detail.key)) {
        applyActiveKey(detail.key);
        // Mirror manual context selection: broadcast immediately so
        // chat-scoped UI stays aligned on multi-hop conversational switches.
        broadcastActiveContext(detail.key);
      } else {
        pendingContextKeyRef.current = detail.key;
        // Persist immediately so a subsequent mount/hydration cycle
        // can still honor the switch even before contexts refresh.
        try { localStorage.setItem('compass-active-context', detail.key); } catch { /* ignore */ }
      }
    };
    window.addEventListener('compass-chat-context-switch', handler);
    return () => window.removeEventListener('compass-chat-context-switch', handler);
  }, [contexts, applyActiveKey, broadcastActiveContext]);

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
      // Switch to the newly created context, atomically persisting
      // to localStorage to survive the refresh re-init race.
      applyActiveKey(detail.key);
      // If the context isn't in props yet, mark it pending so the
      // next contexts refresh applies it deterministically.
      if (!contexts.some(c => c.key === detail.key)) {
        pendingContextKeyRef.current = detail.key;
      }
      // Delay refresh slightly to let Blob write propagate
      setTimeout(() => router.refresh(), 1500);
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
  }, [router, contexts, applyActiveKey]);

  // Listen for trip attribute attachments from chat
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; attributes: TripAttributeChip[] }>).detail;
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


  useEffect(() => {
    if (!activeKey) return;

    const visibleDigestItems = digestItems.filter(item => item.contextKey === activeKey);
    const entryIds = visibleDigestItems.map(item => item.entryId);
    const hydrated = digestHydratedContextsRef.current.has(activeKey);

    if (!hydrated) {
      seenDigestEntryIdsRef.current[activeKey] = entryIds;
      digestHydratedContextsRef.current.add(activeKey);
      return;
    }

    if (visibleDigestItems.length === 0) {
      seenDigestEntryIdsRef.current[activeKey] = [];
      return;
    }

    const previousEntryIds = seenDigestEntryIdsRef.current[activeKey] ?? [];
    const promptChips = buildMonitoringPromptAttachmentChips({
      contextKey: activeKey,
      digestItems: visibleDigestItems,
      previousEntryIds,
      limit: 1,
    });
    const intelChips = buildIntelligenceAttachmentChips({
      contextKey: activeKey,
      digestItems: visibleDigestItems,
      previousEntryIds,
      limit: 1,
    });
    seenDigestEntryIdsRef.current[activeKey] = entryIds;

    const nextChips = [...promptChips, ...intelChips].slice(0, 2);
    if (nextChips.length === 0) return;

    setAttachingAttrs(prev => ({
      ...prev,
      [activeKey]: [...(prev[activeKey] ?? []), ...nextChips],
    }));

    const timer = setTimeout(() => {
      setAttachingAttrs(prev => {
        const next = { ...prev };
        const remaining = (next[activeKey] ?? []).filter(attr => !nextChips.some(chip => chip.field === attr.field && chip.value === attr.value && chip.label === attr.label));
        if (remaining.length > 0) next[activeKey] = remaining;
        else delete next[activeKey];
        return next;
      });
    }, 3200);

    return () => clearTimeout(timer);
  }, [activeKey, digestItems]);

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
  const reviewUrl = `/review/${encodeURIComponent(ctx.key)}`;
  const monitoringActionPrompts = buildMonitoringActionPrompts({
    contextKey: ctx.key,
    digestItems: digestItems.filter(item => item.contextKey === ctx.key),
  });
  const monitoringActionSummary = summarizeMonitoringActionPrompts(monitoringActionPrompts);

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
                  {landingAttrs.map(attr => {
                    const icon = attr.icon ?? (attr.field === 'dates'
                      ? '📅'
                      : attr.field === 'city'
                        ? '📍'
                        : attr.field === 'purpose'
                          ? '🎯'
                          : attr.field === 'people'
                            ? '👥'
                            : attr.field === 'intelligence'
                              ? '🛰️'
                              : '🏷');
                    const attrHref = attr.action === 'saved' ? `${reviewUrl}?tab=saved` : attr.action === 'review' ? reviewUrl : null;
                    return (
                      <span key={`${attr.field}:${attr.value}`} className="section-attr-pill">
                        <span>{icon} {attr.label ? `${attr.label}: ` : ''}{attr.value}</span>
                        {attrHref && (
                          <Link href={attrHref} className="section-attr-pill-link">
                            {attr.action === 'saved' ? 'Review saved' : 'Open review'} →
                          </Link>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="focused-hero-right">
            {ctx.type === 'trip' && monitoringActionSummary && (
              <Link
                href={monitoringActionSummary.action === 'saved' ? `${reviewUrl}?tab=saved` : reviewUrl}
                className={`trip-action-summary trip-action-summary-${monitoringActionSummary.tone}`}
              >
                {monitoringActionSummary.label} →
              </Link>
            )}
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
                monitoringActionPrompts={monitoringActionPrompts}
                monitoringActionSummary={monitoringActionSummary}
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
          <div className="focused-empty-discoveries focused-empty-discoveries-compact">
            <p className="focused-empty-title">No discoveries yet</p>
            <p className="focused-empty-hint">Try asking:</p>
            <div className="focused-empty-prompts">
              {ctx.city ? (
                <>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: `Find great restaurants in ${ctx.city}` } }));
                  }}>📍 Find great restaurants in {ctx.city}</button>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: `What are the must-see galleries in ${ctx.city}?` } }));
                  }}>🎨 What are the must-see galleries in {ctx.city}?</button>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: `Best jazz bars in ${ctx.city}` } }));
                  }}>🎵 Best jazz bars in {ctx.city}</button>
                </>
              ) : (
                <>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: 'Find restaurants for my trip' } }));
                  }}>📍 Find restaurants for my trip</button>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: 'What are the must-see spots?' } }));
                  }}>🎨 What are the must-see spots?</button>
                  <button type="button" className="focused-empty-prompt" onClick={() => {
                    window.dispatchEvent(new CustomEvent('compass-prefill-chat', { detail: { text: 'Best live music venues?' } }));
                  }}>🎵 Best live music venues?</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
