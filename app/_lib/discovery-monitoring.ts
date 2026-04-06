import { list } from '@vercel/blob';
import type {
  Context,
  ContextTriage,
  Discovery,
  MonitorDimension,
  MonitorReason,
  MonitorStatus,
  TriageStore,
} from './types';
import { getDiscoveryHistoryKey, listRecentDiscoveryHistory } from './discovery-history';

const BLOB_PREFIX = 'users';
const MONITOR_HISTORY_LIMIT = 60;
const RECENT_WINDOW_DAYS = 45;

type MonitorType = NonNullable<Discovery['monitorType']>;

interface ObservationSummary {
  count: number;
  recentCount: number;
  distinctSources: number;
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

export async function annotateDiscoveriesForMonitoring(params: {
  userId: string;
  discoveries: Discovery[];
  contexts: Context[];
}): Promise<Discovery[]> {
  const { userId, discoveries, contexts } = params;
  const [triageStore, historyEvents] = await Promise.all([
    loadServerTriageStore(userId),
    listRecentDiscoveryHistory(userId, MONITOR_HISTORY_LIMIT),
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
    };
  });
}
