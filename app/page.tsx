import Link from 'next/link';
import { list } from '@vercel/blob';
import { getCurrentUser } from './_lib/user';
import { getEffectiveDerivedUserDiscoveries, getEffectiveUserManifest } from './_lib/effective-user-data';
import type { Context, Discovery } from './_lib/types';
import { isContextActive } from './_lib/context-lifecycle';
import { getHeroImage } from './_lib/image-url.server';
import { isTypeCompatible } from './_lib/context-compat';
import { scoreDiscovery } from './_lib/discovery-score';
import { rankDiscoveriesForHomepage } from './_lib/discovery-preferences';
import { annotateDiscoveriesForMonitoring } from './_lib/discovery-monitoring';
import { bulkPromoteFromAnnotated, loadMonitorInventory } from './_lib/monitor-inventory';
import type { MonitorChangeKind } from './_lib/monitor-inventory';
import type { SignificanceLevel } from './_lib/observation-significance';
import { buildHomepageDigest } from './_lib/monitor-digest';
import HomeClient from './_components/HomeClient';

export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'users';

type TriageEntry = { state: string };
type ContextTriage = { triage?: Record<string, TriageEntry> };
type TriageStore = Record<string, ContextTriage>;

function triageBlobPath(userId: string) {
  return `${BLOB_PREFIX}/${userId}/triage.json`;
}

async function loadDismissedDiscoveryIds(userId: string): Promise<Set<string>> {
  try {
    const { blobs } = await list({ prefix: triageBlobPath(userId), limit: 1 });
    const blob = blobs[0];
    if (!blob) return new Set();

    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return new Set();

    const store = (await res.json()) as TriageStore;
    const dismissed = new Set<string>();
    for (const ctx of Object.values(store)) {
      for (const [discoveryId, entry] of Object.entries(ctx.triage ?? {})) {
        if (entry.state === 'dismissed') dismissed.add(discoveryId);
      }
    }
    return dismissed;
  } catch {
    return new Set();
  }
}

function getDiscoveryTriageId(discovery: Discovery): string | null {
  return discovery.place_id || discovery.id || null;
}

function filterDismissedDiscoveries(discoveries: Discovery[], dismissedDiscoveryIds: Set<string>): Discovery[] {
  if (dismissedDiscoveryIds.size === 0) return discoveries;
  return discoveries.filter((discovery) => {
    const triageId = getDiscoveryTriageId(discovery);
    return !triageId || !dismissedDiscoveryIds.has(triageId);
  });
}

function sortContexts(contexts: Context[]): Context[] {
  return [...contexts].sort((a, b) => {
    // Trips with dates first (nearest date first)
    if (a.type === 'trip' && b.type !== 'trip') return -1;
    if (b.type === 'trip' && a.type !== 'trip') return 1;
    // Outings next
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

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🧭 Compass</h1>
          <p>Personal travel intelligence. <Link href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</Link> to get started.</p>
        </div>
      </main>
    );
  }

  const [manifest, discoveriesData] = await Promise.all([
    getEffectiveUserManifest(user.id),
    getEffectiveDerivedUserDiscoveries(user.id),
  ]);

  // Non-owner with no manifest → onboarding
  if (!user.isOwner && (!manifest || manifest.contexts.length === 0)) {
    const { redirect } = await import('next/navigation');
    redirect('/onboarding');
  }

  const contexts = sortContexts(
    (manifest?.contexts ?? []).filter(c => isContextActive(c)),
  );
  const discoveries = discoveriesData?.discoveries ?? [];
  const dismissedDiscoveryIds = await loadDismissedDiscoveryIds(user.id);

  // Filter out discoveries that are not fully built
  // A discovery must have at minimum: a name AND (address OR description OR rating)
  const fullyBuilt = discoveries.filter(d => {
    if (!d.name || d.name === 'Unknown Place') return false;
    // Chat-sourced discoveries may not have address/rating yet — always show them
    if (d.source?.startsWith('chat:')) return true;
    const rec = d as unknown as Record<string, unknown>;
    const hasAddress = !!(rec.address as string);
    const hasDescription = !!(rec.description || rec.summary);
    const hasRating = d.rating != null && d.rating > 0;
    return hasAddress || hasDescription || hasRating;
  });
  const discoveries_final = fullyBuilt;

  const enrichedDiscoveries = enrichDiscoveriesWithImageMinimums(discoveries_final);
  const visibleDiscoveries = filterDismissedDiscoveries(enrichedDiscoveries, dismissedDiscoveryIds);

  // Group discoveries by context — fuzzy match on slug to handle key variants
  // Fix #108: deduplicate by place_id within each context bucket
  const byContext = new Map<string, Discovery[]>();
  for (const ctx of contexts) {
    const ctxSlug = ctx.key.split(':').slice(1).join(':');
    const matched = visibleDiscoveries.filter(d => {
      // Type-context compatibility check (e.g. no galleries in dinner outings)
      if (!isTypeCompatible(ctx.key, d.type)) return false;
      // Exact match first
      if (d.contextKey === ctx.key) return true;
      // Empty contextKey defaults to first context (typically the active trip)
      if (!d.contextKey || d.contextKey === '') {
        return ctx.key === contexts[0]?.key;
      }
      // Fuzzy: slug contains or is contained by context slug
      const dSlug = d.contextKey.split(':').slice(1).join(':');
      return dSlug === ctxSlug || dSlug.includes(ctxSlug) || ctxSlug.includes(dSlug);
    });

    // Deduplicate by place_id (keep first occurrence), then by id
    const seenPlaceIds = new Set<string>();
    const seenIds = new Set<string>();
    const deduped = matched.filter(d => {
      if (d.place_id) {
        if (seenPlaceIds.has(d.place_id)) return false;
        seenPlaceIds.add(d.place_id);
      }
      if (seenIds.has(d.id)) return false;
      seenIds.add(d.id);
      return true;
    });

    // Preserve context metadata on discoveries so card-level enrichment can
    // still resolve photos even when a recommendation lacks a Google Place ID.
    const withPhoto = deduped.map((d) => ({
      ...d,
      city: d.city || ctx.city,
      contextLabel: (d as any).contextLabel || ctx.label,
    }));
    byContext.set(ctx.key, withPhoto);
  }

  // Fix #108 (global): deduplicate place_ids across ALL context carousels
  // A place appearing in NYC trip should not also appear in the Toronto radar carousel
  const globalSeenPlaceIds = new Set<string>();
  for (const [ctxKey, items] of byContext) {
    const globalDeduped = items.filter(d => {
      if (!d.place_id) return true; // no place_id → always show (won't match cross-context)
      if (globalSeenPlaceIds.has(d.place_id)) return false;
      globalSeenPlaceIds.add(d.place_id);
      return true;
    });
    byContext.set(ctxKey, globalDeduped);
  }

  const rankedDiscoveries = await rankDiscoveriesForHomepage({
    userId: user.id,
    discoveries: Array.from(byContext.values()).flat(),
    contexts,
    baseScore: (discovery) => scoreDiscovery(discovery).total,
  });

  const monitoredDiscoveries = await annotateDiscoveriesForMonitoring({
    userId: user.id,
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

  // Auto-promote active/priority monitored places into the durable inventory (fire-and-forget)
  bulkPromoteFromAnnotated(user.id, monitoredDiscoveries);

  // Load durable inventory for change signals
  const inventory = await loadMonitorInventory(user.id);
  const inventoryById = new Map(
    inventory.entries.flatMap(e => [
      [e.id, e],
      [e.discoveryId, e],
    ]),
  );

  // Hide contexts with no discoveries in their final ranked bucket (homepage only).
  // Contexts remain accessible in /review and other pages — this suppression is
  // limited to homepage rendering so the page never shows empty carousels.
  // Trip contexts are always shown (they carry planning widgets even without discoveries).
  const visibleContexts = contexts.filter(c =>
    c.type === 'trip' || (byContext.get(c.key)?.length ?? 0) > 0
  );

  // Build contextMeta — structured trip data for widgets
  const contextMeta = Object.fromEntries(
    visibleContexts
      .filter(c => c.type === 'trip')
      .map(c => {
        const raw = c as unknown as Record<string, unknown>;
        return [c.key, {
          travel: raw.travel,
          accommodation: raw.accommodation,
          bookingStatus: raw.bookingStatus as string | undefined,
        }];
      })
  );

  // Build monitoring queue: due-now places + priority monitored places (up to 8)
  const monitoringQueue: Array<{
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
  }> = monitoredDiscoveries
    .filter(d => {
      if (!d.monitorStatus || d.monitorStatus === 'none') return false;
      if (d.monitorDueNow) return true;
      // Also include places whose durable inventory status escalated to priority
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
      // Within same status group: critical/notable significance first
      const sigRank: Record<string, number> = { critical: 3, notable: 2, routine: 1, noise: 0 };
      return (sigRank[bInvForSort?.peakSignificanceLevel ?? 'noise'] ?? 0) - (sigRank[aInvForSort?.peakSignificanceLevel ?? 'noise'] ?? 0);
    })
    .slice(0, 8)
    .map(d => {
      const inv = inventoryById.get(d.place_id ?? d.id) ?? inventoryById.get(d.id);
      return {
        id: d.id,
        name: d.name,
        city: d.city,
        type: d.type,
        contextKey: d.contextKey,
        // Prefer durable inventory status (may have been escalated by significance)
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

  // Build significance digest for recent changes banner
  const homepageDigest = buildHomepageDigest(inventory);

  return (
    <HomeClient
      userId={user.id}
      contexts={visibleContexts}
      discoveryMap={Object.fromEntries(byContext)}
      contextMeta={contextMeta}
      monitoringQueue={monitoringQueue}
      digestTeaser={homepageDigest.teaserText}
      digestItems={homepageDigest.items}
    />
  );
}
