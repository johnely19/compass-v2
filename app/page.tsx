import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from './_lib/user';
import { getUserManifest, getUserDiscoveries } from './_lib/user-data';
import type { Context, Discovery, UserManifest } from './_lib/types';
import { isContextActive } from './_lib/context-lifecycle';
import { resolveImageUrl, getManifestHeroImage } from './_lib/image-url';
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
    return (raw.discoveries ?? []) as Discovery[];
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

  // Merge contexts: Blob manifest + local manifest (for any missing contexts)
  const blobContexts = blobManifest?.contexts ?? [];
  const localContexts = loadLocalManifest()?.contexts ?? [];
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
  const localDisc = loadLocalDiscoveries();
  const blobIds = new Set(blobDiscoveries.map(d => d.id));
  const discoveries = [
    ...blobDiscoveries,
    ...localDisc.filter(d => !blobIds.has(d.id)),
  ];

  // Enrich discoveries with resolved image URLs
  const enrichedDiscoveries = discoveries.map(d => {
    let heroImage = resolveImageUrl(d.heroImage);
    // Fallback: pull from place card manifest if no heroImage
    if (!heroImage && d.place_id) {
      heroImage = getManifestHeroImage(d.place_id);
    }
    return heroImage ? { ...d, heroImage } : d;
  });

  // Group discoveries by context — fuzzy match on slug to handle key variants
  const byContext = new Map<string, Discovery[]>();
  for (const ctx of contexts) {
    const ctxSlug = ctx.key.split(':').slice(1).join(':');
    byContext.set(
      ctx.key,
      enrichedDiscoveries.filter(d => {
        if (d.contextKey === ctx.key) return true;
        // Fuzzy: slug contains or is contained by context slug
        const dSlug = d.contextKey.split(':').slice(1).join(':');
        return dSlug === ctxSlug || dSlug.includes(ctxSlug) || ctxSlug.includes(dSlug);
      }),
    );
  }

  return (
    <HomeClient
      userId={user.id}
      contexts={contexts}
      discoveryMap={Object.fromEntries(byContext)}
    />
  );
}
