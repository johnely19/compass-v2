import { list } from '@vercel/blob';
import type {
  Context,
  ContextTriage,
  Discovery,
  MonitorDimension,
  MonitorReason,
  MonitorSourceHint,
  MonitorStatus,
  TriageStore,
} from './types';
import { getDiscoveryHistoryKey, listRecentDiscoveryHistory } from './discovery-history';
import { loadCheckinStore, getLatestCheckinAt } from './monitor-checkins';

const BLOB_PREFIX = 'users';
const MONITOR_HISTORY_LIMIT = 60;
const RECENT_WINDOW_DAYS = 45;

type MonitorType = NonNullable<Discovery['monitorType']>;

interface ObservationSummary {
  count: number;
  recentCount: number;
  distinctSources: number;
  lastObservedAt?: string;
}

export interface MonitoringDigestItem {
  id: string;
  name: string;
  contextKey: string;
  status: MonitorStatus;
  type: MonitorType;
  dueNow: boolean;
  nextCheckAt?: string;
  lastObservedAt?: string;
  explanation?: string;
}

export interface MonitoringDigest {
  total: number;
  dueNow: number;
  byStatus: Record<Exclude<MonitorStatus, 'none'>, number>;
  byType: Partial<Record<MonitorType, number>>;
  nextUp: MonitoringDigestItem[];
}

interface TriageSummary {
  savedCount: number;
  dismissedCount: number;
  resurfacedCount: number;
}

const MONITOR_REASON_LABELS: Record<MonitorReason, string> = {
  saved: 'saved',
  contentious: 'contentious',
  'repeated-signal': 'repeated signal',
  'live-trip': 'live trip',
  volatile: 'volatile',
  shortlist: 'shortlist',
};

const TYPE_DIMENSIONS: Record<MonitorType, MonitorDimension[]> = {
  hospitality: [
    { key: 'reservations', label: 'Reservations', description: 'Watch bookability, release windows, and sell-out pressure.' },
    { key: 'hours', label: 'Hours', description: 'Track service days, seasonal closures, and late changes.' },
    { key: 'menu', label: 'Menu / drinks', description: 'Notice chef, menu, or bar-program shifts that change the reason to go.' },
    { key: 'buzz', label: 'Buzz', description: 'Monitor awards, critical heat, and repeat mention momentum.' },
  ],
  stay: [
    { key: 'availability', label: 'Availability', description: 'Track open nights, sold-out weekends, and release timing.' },
    { key: 'pricing', label: 'Pricing', description: 'Watch rate drift, packages, and shoulder-season opportunities.' },
    { key: 'policies', label: 'Policies', description: 'Notice cancellation, minimum-stay, and pet/guest rule changes.' },
    { key: 'condition', label: 'Condition', description: 'Track renovation, amenity, and seasonal suitability updates.' },
  ],
  development: [
    { key: 'timeline', label: 'Timeline', description: 'Watch approvals, launch timing, occupancy, and completion slips.' },
    { key: 'pricing', label: 'Pricing / sales', description: 'Track price sheets, incentives, and absorption signals.' },
    { key: 'design', label: 'Design / amenities', description: 'Notice material, amenity, or architect-story changes.' },
    { key: 'construction', label: 'Construction', description: 'Monitor visible progress and major permitting milestones.' },
  ],
  culture: [
    { key: 'program', label: 'Program', description: 'Track exhibitions, lineups, residencies, and event calendars.' },
    { key: 'tickets', label: 'Tickets', description: 'Watch release dates, timed-entry pressure, and sellouts.' },
    { key: 'hours', label: 'Hours', description: 'Notice closure days, special openings, and seasonal schedule changes.' },
    { key: 'news', label: 'News', description: 'Watch curator, artist, and venue announcements that change relevance.' },
  ],
  general: [
    { key: 'status', label: 'Status', description: 'Monitor whether the place is becoming more actionable or more uncertain.' },
    { key: 'signal', label: 'Signal strength', description: 'Watch whether it keeps resurfacing from independent inputs.' },
  ],
};

const TYPE_SOURCE_HINTS: Record<MonitorType, MonitorSourceHint[]> = {
  hospitality: [
    { key: 'official', label: 'Official site / booking page', rationale: 'Best source for menu shifts, release windows, and service-hour changes.' },
    { key: 'maps', label: 'Google Maps profile', rationale: 'Good for live hours, temporary closures, and review velocity.' },
    { key: 'social', label: 'Instagram / newsletter', rationale: 'Often where chef changes, pop-ups, and seasonal drops appear first.' },
  ],
  stay: [
    { key: 'official', label: 'Official stay listing', rationale: 'Primary source for availability, rates, policies, and packages.' },
    { key: 'marketplace', label: 'Booking / rental marketplace', rationale: 'Useful for sold-out weekends, price drift, and minimum-stay changes.' },
    { key: 'reviews', label: 'Recent guest reviews', rationale: 'Fastest signal for condition changes, amenity issues, or standout improvements.' },
  ],
  development: [
    { key: 'developer', label: 'Developer / project site', rationale: 'Best source for launch timing, price sheets, and amenity revisions.' },
    { key: 'planning', label: 'Planning / permit filings', rationale: 'Shows approvals, delays, and scope changes before marketing catches up.' },
    { key: 'site', label: 'Construction updates', rationale: 'Visible progress is often the clearest signal of real momentum.' },
  ],
  culture: [
    { key: 'program', label: 'Program / calendar page', rationale: 'Best source for exhibitions, lineups, and schedule changes.' },
    { key: 'ticketing', label: 'Ticketing flow', rationale: 'Good for release timing, timed-entry pressure, and sellouts.' },
    { key: 'press', label: 'Press / newsletter / social', rationale: 'Captures curator, artist, and venue announcements that change relevance.' },
  ],
  general: [
    { key: 'official', label: 'Official source', rationale: 'Best source to confirm whether the place is materially changing.' },
    { key: 'maps', label: 'Google Maps profile', rationale: 'Useful for status, hours, and fresh public signal.' },
  ],
};

function triageBlobPath(userId: string) {
  return `${BLOB_PREFIX}/${userId}/triage.json`;
}

async function loadServerTriageStore(userId: string): Promise<TriageStore> {
  try {
    const { blobs } = await list({ prefix: triageBlobPath(userId), limit: 1 });
    const blob = blobs[0];
    if (!blob) return {};
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as TriageStore;
  } catch {
    return {};
  }
}

function normalizeToken(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function daysAgo(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (1000 * 60 * 60 * 24);
}

function latestIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function placeLookupKeys(discovery: Discovery): string[] {
  const keys = new Set<string>();
  if (discovery.place_id) keys.add(`place:${discovery.place_id}`);
  keys.add(`history:${getDiscoveryHistoryKey(discovery)}`);
  if (discovery.name) keys.add(`name:${normalizeToken(discovery.name)}`);
  return Array.from(keys);
}

function getMonitorType(discovery: Discovery): MonitorType {
  if (['restaurant', 'bar', 'cafe'].includes(discovery.type)) return 'hospitality';
  if (['hotel', 'accommodation'].includes(discovery.type)) return 'stay';
  if (discovery.type === 'development') return 'development';
  if (['museum', 'gallery', 'theatre', 'music-venue', 'experience'].includes(discovery.type)) return 'culture';
  return 'general';
}

function getMonitorDimensions(discovery: Discovery): MonitorDimension[] {
  return TYPE_DIMENSIONS[getMonitorType(discovery)] ?? TYPE_DIMENSIONS.general;
}

function summarizeObservations(discoveries: Discovery[], historyEvents: Awaited<ReturnType<typeof listRecentDiscoveryHistory>>) {
  const summary = new Map<string, ObservationSummary>();
  const seenSources = new Map<string, Set<string>>();

  const ensure = (key: string) => {
    const current = summary.get(key);
    if (current) return current;
    const created: ObservationSummary = { count: 0, recentCount: 0, distinctSources: 0 };
    summary.set(key, created);
    return created;
  };

  for (const discovery of discoveries) {
    const key = getDiscoveryHistoryKey(discovery);
    ensure(key);
    seenSources.set(key, new Set<string>());
  }

  for (const event of historyEvents) {
    const isRecent = daysAgo(event.recordedAt) <= RECENT_WINDOW_DAYS;
    for (const discovery of [...event.added, ...event.updated]) {
      const key = getDiscoveryHistoryKey(discovery);
      const item = ensure(key);
      item.count += 1;
      if (isRecent) item.recentCount += 1;
      item.lastObservedAt = latestIso(item.lastObservedAt, event.recordedAt);
      const sources = seenSources.get(key) ?? new Set<string>();
      sources.add(event.source);
      seenSources.set(key, sources);
    }
  }

  for (const [key, sources] of seenSources) {
    const item = ensure(key);
    item.distinctSources = sources.size;
  }

  return summary;
}

function summarizeTriageForDiscovery(discovery: Discovery, triageStore: TriageStore): TriageSummary {
  const keys = placeLookupKeys(discovery);
  let savedCount = 0;
  let dismissedCount = 0;
  let resurfacedCount = 0;

  for (const [contextKey, context] of Object.entries(triageStore)) {
    const ctx = context as ContextTriage;
    const triageEntries = Object.entries(ctx.triage ?? {});
    const matching = triageEntries.filter(([placeId]) => {
      if (discovery.place_id && placeId === discovery.place_id) return true;
      const seen = ctx.seen?.[placeId];
      if (!seen) return false;
      return keys.includes(`name:${normalizeToken(seen.name)}`)
        || keys.includes(`history:${getDiscoveryHistoryKey({
          id: placeId,
          place_id: placeId,
          name: seen.name,
          city: seen.city,
          type: seen.type,
          contextKey,
          source: 'triage:seen',
          discoveredAt: seen.firstSeen,
          placeIdStatus: 'verified',
        })}`);
    });

    for (const [, entry] of matching) {
      if (entry.state === 'saved') savedCount += 1;
      if (entry.state === 'dismissed') dismissedCount += 1;
      if (entry.state === 'resurfaced') resurfacedCount += 1;
    }
  }

  return { savedCount, dismissedCount, resurfacedCount };
}

function inferVolatileReason(discovery: Discovery, activeTripRelevant: boolean): boolean {
  if (['hotel', 'accommodation', 'development'].includes(discovery.type)) return true;
  if (activeTripRelevant && ['restaurant', 'bar', 'cafe', 'museum', 'gallery', 'theatre', 'music-venue'].includes(discovery.type)) {
    return true;
  }
  return false;
}

function pushReason(reasons: MonitorReason[], reason: MonitorReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function scoreMonitoringCandidate(args: {
  reasons: MonitorReason[];
  triage: TriageSummary;
  observation: ObservationSummary;
  activeTripRelevant: boolean;
  rankingScore?: number;
}) {
  const { reasons, triage, observation, activeTripRelevant, rankingScore } = args;
  let score = 0;
  if (reasons.includes('saved')) score += 4;
  if (reasons.includes('live-trip')) score += 4;
  if (reasons.includes('repeated-signal')) score += observation.recentCount >= 3 || observation.distinctSources >= 2 ? 3 : 2;
  if (reasons.includes('contentious')) score += triage.resurfacedCount > 0 ? 3 : 2;
  if (reasons.includes('shortlist')) score += (rankingScore ?? 0) >= 92 ? 3 : 2;
  if (reasons.includes('volatile')) score += activeTripRelevant ? 2 : 1;
  return score;
}

function toMonitorStatus(score: number): MonitorStatus {
  if (score >= 9) return 'priority';
  if (score >= 6) return 'active';
  if (score >= 3) return 'candidate';
  return 'none';
}

function summarizeReasons(reasons: MonitorReason[]): string {
  return reasons.map((reason) => MONITOR_REASON_LABELS[reason]).slice(0, 3).join(' · ');
}

export function getMonitorStatusLabel(status: MonitorStatus | undefined): string {
  switch (status) {
    case 'candidate': return 'Candidate';
    case 'active': return 'Active';
    case 'priority': return 'Priority';
    default: return 'None';
  }
}

export function getMonitoringExplanation(discovery: Partial<Discovery>): string | null {
  if (discovery.monitorExplanation) return discovery.monitorExplanation;
  if (!discovery.monitorReasons?.length) return null;
  return summarizeReasons(discovery.monitorReasons);
}

function getMonitorCadence(args: {
  status: MonitorStatus;
  volatile: boolean;
  activeTripRelevant: boolean;
  repeatedSignalStrong: boolean;
}): string | undefined {
  const { status, volatile, activeTripRelevant, repeatedSignalStrong } = args;
  if (status === 'none') return undefined;
  if (status === 'priority') {
    if (activeTripRelevant || volatile) return 'Daily during planning window';
    return 'Weekly';
  }
  if (status === 'active') {
    if (activeTripRelevant || volatile) return 'Twice weekly';
    if (repeatedSignalStrong) return 'Weekly';
    return 'Every 2 weeks';
  }
  return repeatedSignalStrong ? 'Every 2 weeks' : 'Monthly';
}

function getMonitorSources(discovery: Discovery, status: MonitorStatus): MonitorSourceHint[] | undefined {
  if (status === 'none') return undefined;
  const monitorType = getMonitorType(discovery);
  return TYPE_SOURCE_HINTS[monitorType] ?? TYPE_SOURCE_HINTS.general;
}

function cadenceIntervalMs(cadence: string | undefined): number | undefined {
  switch (cadence) {
    case 'Daily during planning window':
      return 24 * 60 * 60 * 1000;
    case 'Twice weekly':
      return 3 * 24 * 60 * 60 * 1000;
    case 'Weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'Every 2 weeks':
      return 14 * 24 * 60 * 60 * 1000;
    case 'Monthly':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function getNextCheckAt(lastObservedAt: string | undefined, cadence: string | undefined): string | undefined {
  const intervalMs = cadenceIntervalMs(cadence);
  if (!lastObservedAt || !intervalMs) return undefined;
  const baseMs = new Date(lastObservedAt).getTime();
  if (!Number.isFinite(baseMs)) return undefined;
  return new Date(baseMs + intervalMs).toISOString();
}

export function buildMonitoringDigest(discoveries: Discovery[], limit = 5): MonitoringDigest {
  const relevant = discoveries.filter((discovery) => discovery.monitorStatus && discovery.monitorStatus !== 'none');
  const byStatus: MonitoringDigest['byStatus'] = {
    candidate: 0,
    active: 0,
    priority: 0,
  };
  const byType: MonitoringDigest['byType'] = {};

  for (const discovery of relevant) {
    const status = discovery.monitorStatus as Exclude<MonitorStatus, 'none'>;
    byStatus[status] += 1;
    const type = (discovery.monitorType ?? 'general') as MonitorType;
    byType[type] = (byType[type] ?? 0) + 1;
  }

  const nextUp = relevant
    .map((discovery) => ({
      id: discovery.place_id || discovery.id,
      name: discovery.name,
      contextKey: discovery.contextKey,
      status: discovery.monitorStatus as Exclude<MonitorStatus, 'none'>,
      type: (discovery.monitorType ?? 'general') as MonitorType,
      dueNow: Boolean(discovery.monitorDueNow),
      nextCheckAt: discovery.monitorNextCheckAt,
      lastObservedAt: discovery.monitorLastObservedAt,
      explanation: discovery.monitorExplanation,
    }))
    .sort((a, b) => {
      if (a.dueNow !== b.dueNow) return a.dueNow ? -1 : 1;
      if (a.status !== b.status) {
        const rank = { priority: 0, active: 1, candidate: 2 } as const;
        return rank[a.status] - rank[b.status];
      }
      const aNext = a.nextCheckAt ? new Date(a.nextCheckAt).getTime() : Number.POSITIVE_INFINITY;
      const bNext = b.nextCheckAt ? new Date(b.nextCheckAt).getTime() : Number.POSITIVE_INFINITY;
      return aNext - bNext;
    })
    .slice(0, limit);

  return {
    total: relevant.length,
    dueNow: relevant.filter((discovery) => discovery.monitorDueNow).length,
    byStatus,
    byType,
    nextUp,
  };
}

export async function annotateDiscoveriesForMonitoring(params: {
  userId: string;
  discoveries: Discovery[];
  contexts: Context[];
}): Promise<Discovery[]> {
  const { userId, discoveries, contexts } = params;
  const [triageStore, historyEvents, checkinStore] = await Promise.all([
    loadServerTriageStore(userId),
    listRecentDiscoveryHistory(userId, MONITOR_HISTORY_LIMIT),
    loadCheckinStore(userId),
  ]);

  const observations = summarizeObservations(discoveries, historyEvents);
  const activeTripContextKeys = new Set(
    contexts
      .filter((context) => context.type === 'trip' && context.active !== false && context.status !== 'archived' && context.status !== 'completed')
      .map((context) => context.key),
  );

  return discoveries.map((discovery) => {
    const triage = summarizeTriageForDiscovery(discovery, triageStore);
    const observation = observations.get(getDiscoveryHistoryKey(discovery)) ?? {
      count: 0,
      recentCount: 0,
      distinctSources: 0,
      lastObservedAt: undefined,
    };

    const activeTripRelevant = activeTripContextKeys.has(discovery.contextKey);
    const repeatedSignalStrong = observation.count >= 3 || observation.recentCount >= 2 || observation.distinctSources >= 2;
    const contentious = triage.resurfacedCount > 0 || (triage.savedCount > 0 && triage.dismissedCount > 0);
    const shortlist = (discovery.rankingScore ?? 0) >= 88 || ((discovery.rankingBaseScore ?? 0) >= 78 && repeatedSignalStrong);
    const volatile = inferVolatileReason(discovery, activeTripRelevant);

    const monitorReasons: MonitorReason[] = [];
    if (triage.savedCount > 0) pushReason(monitorReasons, 'saved');
    if (contentious) pushReason(monitorReasons, 'contentious');
    if (repeatedSignalStrong) pushReason(monitorReasons, 'repeated-signal');
    if (activeTripRelevant) pushReason(monitorReasons, 'live-trip');
    if (shortlist) pushReason(monitorReasons, 'shortlist');
    if (volatile && monitorReasons.length > 0) pushReason(monitorReasons, 'volatile');

    const monitorScore = scoreMonitoringCandidate({
      reasons: monitorReasons,
      triage,
      observation,
      activeTripRelevant,
      rankingScore: discovery.rankingScore,
    });
    const monitorStatus = toMonitorStatus(monitorScore);
    const monitorType = getMonitorType(discovery);
    const monitorDimensions = monitorStatus === 'none' ? undefined : getMonitorDimensions(discovery);
    const monitorCadence = getMonitorCadence({
      status: monitorStatus,
      volatile,
      activeTripRelevant,
      repeatedSignalStrong,
    });
    const monitorSources = getMonitorSources(discovery, monitorStatus);
    const checkinAt = getLatestCheckinAt(checkinStore, getDiscoveryHistoryKey(discovery));
    // Checkin timestamp wins over discovery history (most recent manual review resets the clock)
    const monitorLastObservedAt = latestIso(checkinAt, observation.lastObservedAt) ?? discovery.discoveredAt;
    const monitorNextCheckAt = monitorStatus === 'none' ? undefined : getNextCheckAt(monitorLastObservedAt, monitorCadence);
    const monitorDueNow = Boolean(monitorNextCheckAt && new Date(monitorNextCheckAt).getTime() <= Date.now());

    const explanationParts: string[] = [];
    if (triage.savedCount > 0) explanationParts.push(triage.savedCount > 1 ? 'saved in multiple reviews' : 'saved already');
    if (contentious) explanationParts.push(triage.resurfacedCount > 0 ? 'resurfaced / mixed signals' : 'split save-dismiss signal');
    if (repeatedSignalStrong) explanationParts.push(
      observation.distinctSources >= 2 ? 'keeps resurfacing across sources' : 'keeps resurfacing in discovery history',
    );
    if (activeTripRelevant) explanationParts.push('belongs to an active trip');
    if (shortlist) explanationParts.push('scores like a shortlist contender');
    if (volatile) explanationParts.push('has time-sensitive details worth watching');

    return {
      ...discovery,
      monitorStatus,
      monitorReasons,
      monitorType,
      monitorDimensions,
      monitorSignals: {
        savedCount: triage.savedCount,
        dismissedCount: triage.dismissedCount,
        resurfacedCount: triage.resurfacedCount,
        observationCount: observation.count,
        recentObservationCount: observation.recentCount,
        distinctSourceCount: observation.distinctSources,
        activeTripRelevant,
        monitorScore,
      },
      monitorExplanation: monitorStatus === 'none' ? undefined : explanationParts.slice(0, 3).join(' · '),
      monitorCadence,
      monitorSources,
      monitorLastObservedAt: monitorStatus === 'none' ? undefined : monitorLastObservedAt,
      monitorNextCheckAt,
      monitorDueNow: monitorStatus === 'none' ? undefined : monitorDueNow,
    };
  });
}
