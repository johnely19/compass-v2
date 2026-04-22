import { getEffectiveDerivedUserDiscoveries, getEffectiveUserManifest } from './effective-user-data';
import type { Context, Discovery } from './types';
import { isContextActive } from './context-lifecycle';
import { getHeroImage } from './image-url.server';
import { isTypeCompatible } from './context-compat';
import { scoreDiscovery } from './discovery-score';
import { rankDiscoveriesForHomepage } from './discovery-preferences';
import { annotateDiscoveriesForMonitoring } from './discovery-monitoring';
import { bulkPromoteFromAnnotated, loadMonitorInventory } from './monitor-inventory';
import type { MonitorChangeKind } from './monitor-inventory';
import type { SignificanceLevel } from './observation-significance';
import { buildHomepageDigest } from './monitor-digest';

export type HomepageDiscovery = Pick<Discovery,
  'id' |
  'place_id' |
  'name' |
  'type' |
  'rating' |
  'heroImage' |
  'images' |
  'contextKey' |
  'city' |
  'rankingExplanation' |
  'monitorStatus' |
  'source' |
  'discoveredAt' |
  'placeIdStatus'
>;

export type HomepageContext = Pick<Context, 'key' | 'label' | 'emoji' | 'type' | 'city' | 'dates' | 'focus'> & {
  purpose?: string;
  people?: Array<{ name: string; relation?: string }>;
};

export interface HomepageContextData {
  context: HomepageContext;
  discoveries: HomepageDiscovery[];
  monitoringQueue: Array<{
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
    detectedChanges?: MonitorChangeKind[];
    significanceLevel?: SignificanceLevel;
    significanceSummary?: string;
    observationCount?: number;
  }>;
}

export interface HomepageData {
  contexts: HomepageContext[];
  initialContextKey: string | null;
  initialDiscoveries: HomepageDiscovery[];
  initialMonitoringQueue: HomepageContextData['monitoringQueue'];
  contextMeta: Record<string, { travel?: unknown; accommodation?: unknown; bookingStatus?: string }>;
  digestTeaser: string | null;
  digestItems: Array<{
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
  }>;
}

function sortContexts(contexts: Context[]): Context[] {
  return [...contexts].sort((a, b) => {
    if (a.type === 'trip' && b.type !== 'trip') return -1;
    if (b.type === 'trip' && a.type !== 'trip') return 1;
    if (a.type === 'outing' && b.type === 'radar') return -1;
    if (b.type === 'outing' && a.type === 'radar') return 1;
    return 0;
  });
}

function enrichDiscoveriesWithImageMinimums(discoveries: Discovery[]): Discovery[] {
  return discoveries.map((discovery) => {
    const heroImage = getHeroImage(discovery.place_id, discovery.heroImage);
    return heroImage ? { ...discovery, heroImage } : discovery;
  });
}

function toHomepageDiscovery(discovery: Discovery): HomepageDiscovery {
  return {
    id: discovery.id,
    place_id: discovery.place_id,
    name: discovery.name,
    type: discovery.type,
    rating: discovery.rating,
    heroImage: discovery.heroImage,
    images: discovery.images,
    contextKey: discovery.contextKey,
    city: discovery.city,
    rankingExplanation: discovery.rankingExplanation,
    monitorStatus: discovery.monitorStatus,
    source: discovery.source,
    discoveredAt: discovery.discoveredAt,
    placeIdStatus: discovery.placeIdStatus,
  };
}

function toHomepageContext(context: Context): HomepageContext {
  const raw = context as unknown as Record<string, unknown>;
  return {
    key: context.key,
    label: context.label,
    emoji: context.emoji,
    type: context.type,
    city: context.city,
    dates: context.dates,
    focus: context.focus,
    purpose: raw.purpose as string | undefined,
    people: raw.people as Array<{ name: string; relation?: string }> | undefined,
  };
}

async function prepareHomepageState(userId: string) {
  const [manifest, discoveriesData] = await Promise.all([
    getEffectiveUserManifest(userId),
    getEffectiveDerivedUserDiscoveries(userId),
  ]);

  const contexts = sortContexts((manifest?.contexts ?? []).filter((c) => isContextActive(c)));
  const discoveries = discoveriesData?.discoveries ?? [];

  const fullyBuilt = discoveries.filter((d) => {
    if (!d.name || d.name === 'Unknown Place') return false;
    if (d.source?.startsWith('chat:')) return true;
    const rec = d as unknown as Record<string, unknown>;
    const hasAddress = !!(rec.address as string);
    const hasDescription = !!(rec.description || rec.summary);
    const hasRating = d.rating != null && d.rating > 0;
    return hasAddress || hasDescription || hasRating;
  });

  const enrichedDiscoveries = enrichDiscoveriesWithImageMinimums(fullyBuilt);
  const byContext = new Map<string, Discovery[]>();

  for (const ctx of contexts) {
    const ctxSlug = ctx.key.split(':').slice(1).join(':');
    const matched = enrichedDiscoveries.filter((d) => {
      if (!isTypeCompatible(ctx.key, d.type)) return false;
      if (d.contextKey === ctx.key) return true;
      if (!d.contextKey || d.contextKey === '') return ctx.key === contexts[0]?.key;
      const dSlug = d.contextKey.split(':').slice(1).join(':');
      return dSlug === ctxSlug || dSlug.includes(ctxSlug) || ctxSlug.includes(dSlug);
    });

    const seenPlaceIds = new Set<string>();
    const seenIds = new Set<string>();
    const deduped = matched.filter((d) => {
      if (d.place_id) {
        if (seenPlaceIds.has(d.place_id)) return false;
        seenPlaceIds.add(d.place_id);
      }
      if (seenIds.has(d.id)) return false;
      seenIds.add(d.id);
      return true;
    });

    byContext.set(ctx.key, deduped);
  }

  const globalSeenPlaceIds = new Set<string>();
  for (const [ctxKey, items] of byContext) {
    byContext.set(ctxKey, items.filter((d) => {
      if (!d.place_id) return true;
      if (globalSeenPlaceIds.has(d.place_id)) return false;
      globalSeenPlaceIds.add(d.place_id);
      return true;
    }));
  }

  const rankedDiscoveries = await rankDiscoveriesForHomepage({
    userId,
    discoveries: Array.from(byContext.values()).flat(),
    contexts,
    baseScore: (discovery) => scoreDiscovery(discovery).total,
  });

  const monitoredDiscoveries = await annotateDiscoveriesForMonitoring({
    userId,
    discoveries: rankedDiscoveries,
    contexts,
  });

  const rankedByKey = new Map(
    monitoredDiscoveries.map((discovery) => [
      discovery.place_id ? `${discovery.contextKey}::${discovery.place_id}` : `${discovery.contextKey}::${discovery.id}`,
      discovery,
    ]),
  );

  for (const [ctxKey, items] of byContext) {
    const ranked = items
      .map((discovery) => rankedByKey.get(discovery.place_id ? `${ctxKey}::${discovery.place_id}` : `${ctxKey}::${discovery.id}`) ?? discovery)
      .sort((a, b) => (b.rankingScore ?? scoreDiscovery(b).total) - (a.rankingScore ?? scoreDiscovery(a).total));
    byContext.set(ctxKey, ranked);
  }

  bulkPromoteFromAnnotated(userId, monitoredDiscoveries);

  const inventory = await loadMonitorInventory(userId);
  const inventoryById = new Map(inventory.entries.flatMap((e) => [[e.id, e], [e.discoveryId, e]]));

  const visibleContexts = contexts.filter((c) => c.type === 'trip' || (byContext.get(c.key)?.length ?? 0) > 0);

  const homepageContexts = visibleContexts.map(toHomepageContext);

  const contextMeta = Object.fromEntries(
    visibleContexts
      .filter((c) => c.type === 'trip')
      .map((c) => {
        const raw = c as unknown as Record<string, unknown>;
        return [c.key, {
          travel: raw.travel,
          accommodation: raw.accommodation,
          bookingStatus: raw.bookingStatus as string | undefined,
        }];
      }),
  );

  const monitoringQueue = monitoredDiscoveries
    .filter((d) => {
      if (!d.monitorStatus || d.monitorStatus === 'none') return false;
      if (d.monitorDueNow) return true;
      const inv = inventoryById.get(d.place_id ?? d.id) ?? inventoryById.get(d.id);
      const effectiveStatus = inv?.monitorStatus ?? d.monitorStatus;
      return effectiveStatus === 'priority';
    })
    .sort((a, b) => {
      if (a.monitorDueNow !== b.monitorDueNow) return a.monitorDueNow ? -1 : 1;
      const rank: Record<string, number> = { priority: 0, active: 1, candidate: 2 };
      const aInvForSort = inventoryById.get(a.place_id ?? a.id) ?? inventoryById.get(a.id);
      const bInvForSort = inventoryById.get(b.place_id ?? b.id) ?? inventoryById.get(b.id);
      const aStatus = aInvForSort?.monitorStatus ?? a.monitorStatus ?? 'candidate';
      const bStatus = bInvForSort?.monitorStatus ?? b.monitorStatus ?? 'candidate';
      const statusDiff = (rank[aStatus] ?? 9) - (rank[bStatus] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      const sigRank: Record<string, number> = { critical: 3, notable: 2, routine: 1, noise: 0 };
      return (sigRank[bInvForSort?.peakSignificanceLevel ?? 'noise'] ?? 0) - (sigRank[aInvForSort?.peakSignificanceLevel ?? 'noise'] ?? 0);
    })
    .slice(0, 8)
    .map((d) => {
      const inv = inventoryById.get(d.place_id ?? d.id) ?? inventoryById.get(d.id);
      return {
        id: d.id,
        name: d.name,
        city: d.city,
        type: d.type,
        contextKey: d.contextKey,
        monitorStatus: inv?.monitorStatus ?? d.monitorStatus ?? 'candidate',
        monitorType: d.monitorType ?? 'general',
        monitorCadence: d.monitorCadence,
        monitorExplanation: d.monitorExplanation,
        dueNow: Boolean(d.monitorDueNow),
        placeId: d.place_id,
        detectedChanges: inv?.detectedChangeKinds,
        significanceLevel: inv?.peakSignificanceLevel,
        significanceSummary: inv?.latestSignificanceSummary,
        observationCount: inv?.observations?.length ?? 0,
      };
    });

  const homepageDigest = buildHomepageDigest(inventory);

  return { visibleContexts, homepageContexts, byContext, contextMeta, monitoringQueue, homepageDigest };
}

export async function getHomepageData(userId: string): Promise<HomepageData> {
  const { homepageContexts, byContext, contextMeta, monitoringQueue, homepageDigest } = await prepareHomepageState(userId);
  const initialContextKey = homepageContexts[0]?.key ?? null;
  // Keep all contexts for the switcher UI, but only SSR discoveries for the active context
  // to keep HTML under 50KB - other contexts load lazily via /api/home/context
  return {
    contexts: homepageContexts,
    initialContextKey,
    // Keep homepage SSR shell lean. Active-context discoveries/monitoring
    // load immediately on the client after mount.
    initialDiscoveries: [],
    initialMonitoringQueue: [],
    contextMeta,
    digestTeaser: homepageDigest.teaserText,
    digestItems: homepageDigest.items,
  };
}

export async function getHomepageContextData(userId: string, contextKey: string): Promise<HomepageContextData | null> {
  const { homepageContexts, byContext, monitoringQueue } = await prepareHomepageState(userId);
  const context = homepageContexts.find((item) => item.key === contextKey);
  if (!context) return null;
  return {
    context,
    discoveries: (byContext.get(context.key) ?? []).map(toHomepageDiscovery),
    monitoringQueue: monitoringQueue.filter((item) => item.contextKey === context.key),
  };
}
