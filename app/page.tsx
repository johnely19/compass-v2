import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from './_lib/user';
import { getUserManifest, getUserDiscoveries } from './_lib/user-data';
import type { Context, Discovery, UserManifest } from './_lib/types';
import { isContextActive } from './_lib/context-lifecycle';
import { resolveImageUrl } from './_lib/image-url';
import { getManifestHeroImage } from './_lib/image-url.server';
import { isTypeCompatible } from './_lib/context-compat';
import { scoreDiscovery } from './_lib/discovery-score';
import { rankDiscoveriesForHomepage } from './_lib/discovery-preferences';
import HomeClient from './_components/HomeClient';

export const dynamic = 'force-dynamic';

/** Load local manifest as fallback when Blob has none */
function loadLocalManifest(): UserManifest | null {
  const p = path.join(process.cwd(), 'data', 'compass-manifest.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return { contexts: raw.contexts ?? [], updatedAt: raw.updatedAt ?? '' };
  } catch { return null; }
}

/** Load local discoveries (cottages, developments) */
function loadLocalDiscoveries(): Discovery[] {
  const p = path.join(process.cwd(), 'data', 'local-discoveries.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return (Array.isArray(raw) ? raw : (raw.discoveries ?? [])) as Discovery[];
  } catch { return []; }
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

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🧭 Compass</h1>
          <p>Personal travel intelligence. <a href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</a> to get started.</p>
        </div>
      </main>
    );
  }

  // Load user data from Blob, with local manifest as fallback
  const [blobManifest, discoveriesData] = await Promise.all([
    getUserManifest(user.id),
    getUserDiscoveries(user.id),
  ]);

  // Non-owner with no manifest → onboarding
  if (!user.isOwner && (!blobManifest || blobManifest.contexts.length === 0)) {
    const { redirect } = await import('next/navigation');
    redirect('/onboarding');
  }

  // Merge contexts: Blob manifest + local manifest (owner only)
  const blobContexts = blobManifest?.contexts ?? [];
  const localContexts = user.isOwner ? (loadLocalManifest()?.contexts ?? []) : [];
  const blobKeys = new Set(blobContexts.map(c => c.key));
  const mergedContexts = [
    ...blobContexts,
    ...localContexts.filter(c => !blobKeys.has(c.key)),
  ];

  const contexts = sortContexts(
    mergedContexts.filter(c => isContextActive(c)),
  );
  // Merge Blob discoveries with local discoveries (cottages, developments)
  const blobDiscoveries = discoveriesData?.discoveries ?? [];
  // Local discoveries (cottages, developments) — owner only
  const localDisc = user.isOwner ? loadLocalDiscoveries() : [];
  const blobIds = new Set(blobDiscoveries.map(d => d.id));
  const discoveries = [
    ...blobDiscoveries,
    ...localDisc.filter(d => !blobIds.has(d.id)),
  ];

  // Filter out discoveries that are not fully built
  // A discovery must have at minimum: a name AND (address OR description OR rating)
  const fullyBuilt = discoveries.filter(d => {
    if (!d.name || d.name === 'Unknown Place') return false;
    const rec = d as unknown as Record<string, unknown>;
    const hasAddress = !!(rec.address as string);
    const hasDescription = !!(rec.description || rec.summary);
    const hasRating = d.rating != null && d.rating > 0;
    return hasAddress || hasDescription || hasRating;
  });
  const discoveries_final = fullyBuilt;

  // Enrich discoveries with resolved image URLs
  // Priority: heroImage field (already resolved) > manifest fallback > Blob place-cards/
  const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';
  const enrichedDiscoveries = discoveries_final.map(d => {
    // 1. Use heroImage if present
    let heroImage: string | null = resolveImageUrl(d.heroImage);
    // 2. Fall back to manifest (local fs)
    if (!heroImage && d.place_id) {
      heroImage = getManifestHeroImage(d.place_id);
    }
    // 3. Fall back to Blob place-cards/{id}/card.json heroImage via URL pattern
    //    (card stubs may have heroImage set from the migration; use URL directly)
    if (!heroImage && d.place_id && BLOB_BASE_URL) {
      // Point at the Blob-hosted card; PlaceCardStore will resolve at render time.
      // For now, mark with a synthetic Blob photo URL to signal availability.
      // Actual resolution happens client-side for cards with real photos in Blob.
      heroImage = null; // leave null — handled below by photo-first sort
    }
    return heroImage ? { ...d, heroImage } : d;
  });

  // Group discoveries by context — fuzzy match on slug to handle key variants
  // Fix #108: deduplicate by place_id within each context bucket
  const byContext = new Map<string, Discovery[]>();
  for (const ctx of contexts) {
    const ctxSlug = ctx.key.split(':').slice(1).join(':');
    const matched = enrichedDiscoveries.filter(d => {
      // Type-context compatibility check (e.g. no galleries in dinner outings)
      if (!isTypeCompatible(ctx.key, d.type)) return false;
      if (d.contextKey === ctx.key) return true;
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

    // Show all places — photos are guaranteed by ingest pipeline (Fix #234)
    const withPhoto = deduped;
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

  const rankedByKey = new Map(
    rankedDiscoveries.map((discovery) => [
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

  // Build contextMeta — structured trip data for widgets
  const contextMeta = Object.fromEntries(
    contexts
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

  return (
    <HomeClient
      userId={user.id}
      contexts={contexts}
      discoveryMap={Object.fromEntries(byContext)}
      contextMeta={contextMeta}
    />
  );
}
