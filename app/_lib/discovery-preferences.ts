import { list } from '@vercel/blob';
import type { Context, ContextTriage, Discovery, DiscoveryType, TriageEntry, TriageStore } from './types';
import { getDiscoveryHistoryKey, listRecentDiscoveryHistory } from './discovery-history';

const BLOB_PREFIX = 'users';
const RECENT_WINDOW_DAYS = 45;
const FRESH_DISCOVERY_DAYS = 21;

interface WeightedDecision {
  contextKey: string;
  focusTokens: string[];
  type: DiscoveryType;
  state: TriageEntry['state'];
  updatedAt: string;
  weight: number;
}

interface PreferenceCounter {
  saved: number;
  dismissed: number;
  recentSaved: number;
  recentDismissed: number;
}

interface ObservationSummary {
  count: number;
  recentCount: number;
  distinctSources: number;
}

export interface PreferenceSignalBreakdown {
  samePlaceSignal: number;
  typeAffinity: number;
  contextAffinity: number;
  repeatObservation: number;
  emergingPreference: number;
  total: number;
  reasons: string[];
}

export interface RankedDiscovery extends Discovery {
  rankingScore: number;
  rankingBaseScore: number;
  preferenceSignals: PreferenceSignalBreakdown;
  rankingExplanation: string;
}

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

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getContextFocusTokens(context: Context | undefined): string[] {
  if (!context) return [];
  return Array.from(
    new Set(
      (context.focus ?? [])
        .map(normalizeToken)
        .filter(Boolean),
    ),
  );
}

function daysAgo(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (1000 * 60 * 60 * 24);
}

function recencyWeight(updatedAt: string): number {
  const ageDays = daysAgo(updatedAt);
  if (ageDays <= 7) return 1.35;
  if (ageDays <= 21) return 1.15;
  if (ageDays <= 45) return 1;
  if (ageDays <= 90) return 0.85;
  return 0.7;
}

function addToCounter(counter: PreferenceCounter, state: TriageEntry['state'], weight: number, isRecent: boolean) {
  if (state === 'saved') {
    counter.saved += weight;
    if (isRecent) counter.recentSaved += weight;
    return;
  }

  if (state === 'dismissed') {
    counter.dismissed += weight;
    if (isRecent) counter.recentDismissed += weight;
  }
}

function createCounter(): PreferenceCounter {
  return {
    saved: 0,
    dismissed: 0,
    recentSaved: 0,
    recentDismissed: 0,
  };
}

function signedPreference(counter: PreferenceCounter | undefined): number {
  if (!counter) return 0;
  const total = counter.saved + counter.dismissed;
  if (total === 0) return 0;
  return (counter.saved - counter.dismissed * 1.15) / (total + 0.75);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function placeLookupKeys(discovery: Discovery): string[] {
  const keys = new Set<string>();
  if (discovery.place_id) keys.add(`place:${discovery.place_id}`);
  keys.add(`history:${getDiscoveryHistoryKey(discovery)}`);
  if (discovery.name) keys.add(`name:${normalizeToken(discovery.name)}`);
  return Array.from(keys);
}

function addPlaceDecisionIndex(index: Map<string, TriageEntry['state'][]>, discovery: Discovery, state: TriageEntry['state']) {
  for (const key of placeLookupKeys(discovery)) {
    const existing = index.get(key) ?? [];
    existing.push(state);
    index.set(key, existing);
  }
}

function summarizePlaceStates(states: TriageEntry['state'][] | undefined): { saved: number; dismissed: number } {
  let saved = 0;
  let dismissed = 0;
  for (const state of states ?? []) {
    if (state === 'saved') saved += 1;
    if (state === 'dismissed') dismissed += 1;
  }
  return { saved, dismissed };
}

function summarizeObservations(discoveries: Discovery[], historyEvents: Awaited<ReturnType<typeof listRecentDiscoveryHistory>>) {
  const summary = new Map<string, ObservationSummary>();

  const ensure = (key: string) => {
    const current = summary.get(key);
    if (current) return current;
    const created: ObservationSummary = { count: 0, recentCount: 0, distinctSources: 0 };
    summary.set(key, created);
    return created;
  };

  const seenSources = new Map<string, Set<string>>();

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

function compactReason(parts: string[]): string {
  return parts.filter(Boolean).slice(0, 3).join(' · ');
}

export async function rankDiscoveriesForHomepage(params: {
  userId: string;
  discoveries: Discovery[];
  contexts: Context[];
  baseScore: (discovery: Discovery) => number;
}): Promise<RankedDiscovery[]> {
  const { userId, discoveries, contexts, baseScore } = params;
  const [triageStore, historyEvents] = await Promise.all([
    loadServerTriageStore(userId),
    listRecentDiscoveryHistory(userId, 60),
  ]);

  const contextByKey = new Map(contexts.map((context) => [context.key, context]));
  const discoveryByPlaceId = new Map<string, Discovery>();
  const discoveryByHistoryKey = new Map<string, Discovery>();
  const discoveryByName = new Map<string, Discovery>();

  for (const discovery of discoveries) {
    if (discovery.place_id) discoveryByPlaceId.set(discovery.place_id, discovery);
    discoveryByHistoryKey.set(getDiscoveryHistoryKey(discovery), discovery);
    discoveryByName.set(normalizeToken(discovery.name), discovery);
  }

  for (const event of historyEvents) {
    for (const discovery of [...event.added, ...event.updated]) {
      if (discovery.place_id && !discoveryByPlaceId.has(discovery.place_id)) {
        discoveryByPlaceId.set(discovery.place_id, discovery);
      }
      if (!discoveryByHistoryKey.has(getDiscoveryHistoryKey(discovery))) {
        discoveryByHistoryKey.set(getDiscoveryHistoryKey(discovery), discovery);
      }
      const normalizedName = normalizeToken(discovery.name);
      if (normalizedName && !discoveryByName.has(normalizedName)) {
        discoveryByName.set(normalizedName, discovery);
      }
    }
  }

  const decisions: WeightedDecision[] = [];
  const typeCounters = new Map<DiscoveryType, PreferenceCounter>();
  const focusCounters = new Map<string, PreferenceCounter>();
  const placeDecisionIndex = new Map<string, TriageEntry['state'][]>();

  for (const [contextKey, ctx] of Object.entries(triageStore)) {
    const context = contextByKey.get(contextKey);
    const focusTokens = getContextFocusTokens(context);

    for (const [placeId, entry] of Object.entries((ctx as ContextTriage).triage ?? {})) {
      if (entry.state !== 'saved' && entry.state !== 'dismissed') continue;

      const seenEntry = (ctx as ContextTriage).seen?.[placeId];
      const discovery = discoveryByPlaceId.get(placeId)
        ?? discoveryByHistoryKey.get(`place:${placeId}:${contextKey}`)
        ?? (seenEntry ? {
          id: placeId,
          place_id: placeId,
          name: seenEntry.name,
          city: seenEntry.city,
          type: seenEntry.type,
          contextKey,
          source: 'triage:seen',
          discoveredAt: seenEntry.firstSeen,
          placeIdStatus: 'verified' as const,
        } : undefined)
        ?? discoveryByName.get(normalizeToken(seenEntry?.name ?? ''));
      if (!discovery) continue;

      const decision: WeightedDecision = {
        contextKey,
        focusTokens,
        type: discovery.type,
        state: entry.state,
        updatedAt: entry.updatedAt,
        weight: recencyWeight(entry.updatedAt),
      };
      decisions.push(decision);

      const isRecent = daysAgo(entry.updatedAt) <= RECENT_WINDOW_DAYS;
      const typeCounter = typeCounters.get(discovery.type) ?? createCounter();
      addToCounter(typeCounter, entry.state, decision.weight, isRecent);
      typeCounters.set(discovery.type, typeCounter);

      for (const token of focusTokens) {
        const focusCounter = focusCounters.get(token) ?? createCounter();
        addToCounter(focusCounter, entry.state, decision.weight, isRecent);
        focusCounters.set(token, focusCounter);
      }

      addPlaceDecisionIndex(placeDecisionIndex, discovery, entry.state);
    }
  }

  const observations = summarizeObservations(discoveries, historyEvents);

  return discoveries
    .map((discovery) => {
      const rankingBaseScore = baseScore(discovery);
      const reasons: string[] = [];

      let samePlaceSignal = 0;
      const placeStates = placeLookupKeys(discovery)
        .flatMap((key) => placeDecisionIndex.get(key) ?? []);
      const placeSummary = summarizePlaceStates(placeStates);
      if (placeSummary.saved > 0) {
        samePlaceSignal = Math.min(10, 6 + (placeSummary.saved - 1) * 2);
        reasons.push(placeSummary.saved > 1 ? 'saved in multiple reviews' : 'saved before');
      } else if (placeSummary.dismissed > 0) {
        samePlaceSignal = -Math.min(10, 5 + (placeSummary.dismissed - 1) * 2);
      }

      const typeScoreRaw = signedPreference(typeCounters.get(discovery.type));
      const typeAffinity = round1(clamp(typeScoreRaw * 12, -8, 12));
      if (typeAffinity >= 3) reasons.push(`${discovery.type.replace(/-/g, ' ')} is a saved type`);

      const currentFocusTokens = getContextFocusTokens(contextByKey.get(discovery.contextKey));
      const focusScores = currentFocusTokens
        .map((token) => signedPreference(focusCounters.get(token)))
        .filter((value) => Math.abs(value) > 0.01);
      const focusAverage = focusScores.length > 0
        ? focusScores.reduce((sum, value) => sum + value, 0) / focusScores.length
        : 0;
      const contextAffinity = round1(clamp(focusAverage * 10, -6, 10));
      if (contextAffinity >= 2.5 && currentFocusTokens.length > 0) {
        reasons.push(`fits ${currentFocusTokens.slice(0, 2).join(' + ')} contexts`);
      }

      const observation = observations.get(getDiscoveryHistoryKey(discovery));
      const repeatObservation = observation
        ? round1(clamp(
            Math.max(0, (observation.count - 1) * 1.8) + Math.max(0, (observation.distinctSources - 1) * 1.2),
            0,
            9,
          ))
        : 0;
      if (repeatObservation >= 3) {
        reasons.push(observation?.distinctSources && observation.distinctSources > 1
          ? 'seen repeatedly across sources'
          : 'seen repeatedly in discovery history');
      }

      const typeCounter = typeCounters.get(discovery.type);
      const recentNet = (typeCounter?.recentSaved ?? 0) - (typeCounter?.recentDismissed ?? 0);
      const lifetimeNet = (typeCounter?.saved ?? 0) - (typeCounter?.dismissed ?? 0);
      const freshnessMultiplier = daysAgo(discovery.discoveredAt) <= FRESH_DISCOVERY_DAYS ? 1 : 0.45;
      const emergingPreference = round1(clamp(
        recentNet > 0
          ? Math.min(8, (recentNet / Math.max(1, (Math.abs(lifetimeNet) + 1))) * 6 * freshnessMultiplier)
          : 0,
        0,
        8,
      ));
      if (emergingPreference >= 2.5) reasons.push('matches a recent saving streak');

      const preferenceSignals: PreferenceSignalBreakdown = {
        samePlaceSignal,
        typeAffinity,
        contextAffinity,
        repeatObservation,
        emergingPreference,
        total: round1(samePlaceSignal + typeAffinity + contextAffinity + repeatObservation + emergingPreference),
        reasons,
      };

      return {
        ...discovery,
        rankingBaseScore,
        rankingScore: round1(rankingBaseScore + preferenceSignals.total),
        preferenceSignals,
        rankingExplanation: compactReason(reasons),
      } satisfies RankedDiscovery;
    })
    .sort((a, b) => b.rankingScore - a.rankingScore);
}
