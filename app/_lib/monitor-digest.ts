/**
 * Monitor Digest
 *
 * Aggregates recent significant observations from the monitor inventory
 * into a structured digest. Designed for:
 *   1. Homepage "Recent Changes" tray — show what moved since last visit
 *   2. External teaser generation (Telegram/Discord briefings)
 *   3. Significance-triggered alerts — surface critical changes immediately
 *
 * The digest is pull-based (computed on request, not stored) and filters
 * observations by recency window and significance threshold.
 */

import type {
  MonitorInventory,
  MonitorObservation,
  MonitorChangeKind,
} from './monitor-inventory';
import type { SignificanceLevel } from './observation-significance';

// ---- Public types ----

export interface DigestItem {
  /** Entry identity */
  entryId: string;
  placeId?: string;
  name: string;
  city: string;
  type: string;
  monitorType: string;
  contextKey: string;
  /** The observation that triggered this digest item */
  observedAt: string;
  source: string;
  /** Significance */
  significanceLevel: SignificanceLevel;
  significanceScore: number;
  significanceSummary: string;
  /** What changed */
  changes: MonitorChangeKind[];
  changeSummary?: string;
  /** State snapshot for context (e.g. "rating dropped from 4.5 → 4.2") */
  stateContext?: DigestStateContext;
}

export interface DigestStateContext {
  rating?: number;
  previousRating?: number;
  reviewCount?: number;
  previousReviewCount?: number;
  operationalStatus?: string;
  previousOperationalStatus?: string;
  priceLevel?: number;
  previousPriceLevel?: number;
}

export interface MonitorDigest {
  /** When this digest was computed */
  computedAt: string;
  /** Time window used */
  windowHours: number;
  /** Minimum significance level included */
  minLevel: SignificanceLevel;
  /** Items grouped by significance level (critical first) */
  critical: DigestItem[];
  notable: DigestItem[];
  routine: DigestItem[];
  /** Total counts */
  totalItems: number;
  totalEntries: number;
  /** Summary stats */
  stats: DigestStats;
}

export interface DigestStats {
  entriesWithChanges: number;
  criticalCount: number;
  notableCount: number;
  routineCount: number;
  /** Most common change kinds across all items */
  topChangeKinds: Array<{ kind: MonitorChangeKind; count: number }>;
  /** Types with most activity */
  activeTypes: Array<{ type: string; count: number }>;
}

// ---- Configuration ----

const LEVEL_RANK: Record<SignificanceLevel, number> = {
  critical: 3,
  notable: 2,
  routine: 1,
  noise: 0,
};

const DEFAULT_WINDOW_HOURS = 168; // 7 days
const DEFAULT_MIN_LEVEL: SignificanceLevel = 'routine';

// ---- Core ----

/**
 * Build a digest from a monitor inventory.
 *
 * Scans all entries for observations within the recency window
 * that meet the minimum significance threshold.
 */
export function buildDigest(params: {
  inventory: MonitorInventory;
  /** Hours to look back (default: 168 = 7 days) */
  windowHours?: number;
  /** Minimum significance level to include (default: 'routine') */
  minLevel?: SignificanceLevel;
  /** Maximum items per level (default: 10) */
  maxPerLevel?: number;
  /** Only include specific monitor types */
  monitorTypes?: string[];
  /** Only include specific context keys */
  contextKeys?: string[];
}): MonitorDigest {
  const {
    inventory,
    windowHours = DEFAULT_WINDOW_HOURS,
    minLevel = DEFAULT_MIN_LEVEL,
    maxPerLevel = 10,
    monitorTypes,
    contextKeys,
  } = params;

  const now = new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const minRank = LEVEL_RANK[minLevel];

  const critical: DigestItem[] = [];
  const notable: DigestItem[] = [];
  const routine: DigestItem[] = [];
  const changeKindCounts = new Map<MonitorChangeKind, number>();
  const typeCounts = new Map<string, number>();
  const entriesWithChanges = new Set<string>();

  for (const entry of inventory.entries) {
    // Apply filters
    if (monitorTypes && !monitorTypes.includes(entry.monitorType)) continue;
    if (contextKeys && !contextKeys.includes(entry.contextKey)) continue;

    for (let i = 0; i < entry.observations.length; i++) {
      const obs = entry.observations[i]!;
      const obsDate = new Date(obs.observedAt);

      // Stop scanning older observations (newest-first order)
      if (obsDate < cutoff) break;

      // Skip noise or below threshold
      const level = obs.significanceLevel ?? inferLevel(obs);
      if (LEVEL_RANK[level] < minRank) continue;

      // Skip observations with no actual changes
      if (!obs.changes || obs.changes.length === 0) continue;

      // Build state context by comparing to next observation (previous state)
      const prevObs = entry.observations[i + 1];
      const stateContext = buildStateContext(obs, prevObs);

      const item: DigestItem = {
        entryId: entry.id,
        placeId: entry.place_id,
        name: entry.name,
        city: entry.city,
        type: entry.type,
        monitorType: entry.monitorType,
        contextKey: entry.contextKey,
        observedAt: obs.observedAt,
        source: obs.source,
        significanceLevel: level,
        significanceScore: obs.significanceScore ?? 0,
        significanceSummary: obs.significanceSummary ?? 'Change detected',
        changes: obs.changes,
        changeSummary: obs.changeSummary,
        stateContext,
      };

      // Route to appropriate bucket
      switch (level) {
        case 'critical': critical.push(item); break;
        case 'notable': notable.push(item); break;
        case 'routine': routine.push(item); break;
      }

      entriesWithChanges.add(entry.id);

      // Track change kind frequency
      for (const kind of obs.changes) {
        changeKindCounts.set(kind, (changeKindCounts.get(kind) ?? 0) + 1);
      }

      // Track type activity
      typeCounts.set(entry.monitorType, (typeCounts.get(entry.monitorType) ?? 0) + 1);
    }
  }

  // Sort each bucket by score descending, then cap
  const sortByScore = (a: DigestItem, b: DigestItem) => b.significanceScore - a.significanceScore;
  critical.sort(sortByScore);
  notable.sort(sortByScore);
  routine.sort(sortByScore);

  const cappedCritical = critical.slice(0, maxPerLevel);
  const cappedNotable = notable.slice(0, maxPerLevel);
  const cappedRoutine = routine.slice(0, maxPerLevel);

  // Build stats
  const topChangeKinds = Array.from(changeKindCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kind, count]) => ({ kind, count }));

  const activeTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return {
    computedAt: now.toISOString(),
    windowHours,
    minLevel,
    critical: cappedCritical,
    notable: cappedNotable,
    routine: cappedRoutine,
    totalItems: critical.length + notable.length + routine.length,
    totalEntries: inventory.entries.length,
    stats: {
      entriesWithChanges: entriesWithChanges.size,
      criticalCount: critical.length,
      notableCount: notable.length,
      routineCount: routine.length,
      topChangeKinds,
      activeTypes,
    },
  };
}

// ---- Helpers ----

/** Infer significance level from changes when not scored */
function inferLevel(obs: MonitorObservation): SignificanceLevel {
  if (!obs.changes || obs.changes.length === 0) return 'noise';
  const criticalKinds: MonitorChangeKind[] = ['closure-signal', 'operational-change'];
  const notableKinds: MonitorChangeKind[] = [
    'price-changed', 'rating-down', 'rating-up',
    'description-changed', 'availability-changed',
    'construction-signal', 'sentiment-shift',
  ];
  if (obs.changes.some(c => criticalKinds.includes(c))) return 'critical';
  if (obs.changes.some(c => notableKinds.includes(c))) return 'notable';
  return 'routine';
}

/** Build human-useful state context for a digest item */
function buildStateContext(
  obs: MonitorObservation,
  prevObs?: MonitorObservation,
): DigestStateContext | undefined {
  const prev = prevObs?.state;
  const curr = obs.state;
  if (!prev && !curr) return undefined;

  const ctx: DigestStateContext = {};
  let hasContext = false;

  if (curr.rating !== undefined) {
    ctx.rating = curr.rating;
    if (prev?.rating !== undefined && prev.rating !== curr.rating) {
      ctx.previousRating = prev.rating;
      hasContext = true;
    }
  }

  if (curr.reviewCount !== undefined) {
    ctx.reviewCount = curr.reviewCount;
    if (prev?.reviewCount !== undefined && prev.reviewCount !== curr.reviewCount) {
      ctx.previousReviewCount = prev.reviewCount;
      hasContext = true;
    }
  }

  if (curr.operationalStatus) {
    ctx.operationalStatus = curr.operationalStatus;
    if (prev?.operationalStatus && prev.operationalStatus !== curr.operationalStatus) {
      ctx.previousOperationalStatus = prev.operationalStatus;
      hasContext = true;
    }
  }

  if (curr.priceLevel !== undefined) {
    ctx.priceLevel = curr.priceLevel;
    if (prev?.priceLevel !== undefined && prev.priceLevel !== curr.priceLevel) {
      ctx.previousPriceLevel = prev.priceLevel;
      hasContext = true;
    }
  }

  return hasContext ? ctx : undefined;
}

// ---- Teaser generation ----

/**
 * Generate a short teaser string from a digest, suitable for external
 * notifications (Telegram/Discord). Follows the ARCHITECTURE.md pattern:
 * "Why should you open Compass right now?"
 */
export function generateTeaser(digest: MonitorDigest): string | null {
  const { critical, notable, stats } = digest;

  if (stats.criticalCount === 0 && stats.notableCount === 0) {
    return null; // Nothing worth a push notification
  }

  const parts: string[] = [];

  // Critical items get individual mention
  for (const item of critical.slice(0, 2)) {
    parts.push(formatTeaserItem(item));
  }

  // Notable items get a count or top mention
  if (notable.length > 0) {
    if (notable.length === 1) {
      parts.push(formatTeaserItem(notable[0]!));
    } else {
      const top = notable[0]!;
      parts.push(`${top.name}: ${top.significanceSummary}`);
      if (notable.length > 1) {
        parts.push(`+${notable.length - 1} more changes worth checking`);
      }
    }
  }

  if (parts.length === 0) return null;

  const icon = critical.length > 0 ? '🔴' : '🟡';
  return `${icon} ${parts.join(' · ')}`;
}

function formatTeaserItem(item: DigestItem): string {
  const ctx = item.stateContext;

  // Rating drop: "Restaurant Name: rating 4.5 → 4.2"
  if (ctx?.previousRating !== undefined && ctx.rating !== undefined) {
    return `${item.name}: rating ${ctx.previousRating} → ${ctx.rating}`;
  }

  // Closure: "Restaurant Name: closure detected"
  if (item.changes.includes('closure-signal')) {
    return `${item.name}: closure detected`;
  }

  // Operational change
  if (item.changes.includes('operational-change') && ctx?.operationalStatus) {
    return `${item.name}: now ${ctx.operationalStatus.toLowerCase().replace(/_/g, ' ')}`;
  }

  // Price change
  if (ctx?.previousPriceLevel !== undefined && ctx.priceLevel !== undefined) {
    const dir = ctx.priceLevel > ctx.previousPriceLevel ? 'up' : 'down';
    return `${item.name}: price level ${dir}`;
  }

  // Fallback to significance summary
  return `${item.name}: ${item.significanceSummary.toLowerCase()}`;
}

// ---- Homepage-specific digest ----

/**
 * Build a lightweight digest suitable for the homepage monitoring tray.
 * Shorter window, only notable+, limited items.
 */
export function buildHomepageDigest(inventory: MonitorInventory): {
  hasSignificantChanges: boolean;
  teaserText: string | null;
  items: DigestItem[];
} {
  const digest = buildDigest({
    inventory,
    windowHours: 72, // 3 days for homepage
    minLevel: 'notable',
    maxPerLevel: 3,
  });

  const items = [...digest.critical, ...digest.notable];
  const teaserText = generateTeaser(digest);

  return {
    hasSignificantChanges: items.length > 0,
    teaserText,
    items,
  };
}
