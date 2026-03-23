import { getCurrentUser } from './_lib/user';
import { getUserManifest, getUserDiscoveries } from './_lib/user-data';
import type { Context, Discovery } from './_lib/types';
import { isContextActive } from './_lib/context-lifecycle';
import HomeClient from './_components/HomeClient';

export const dynamic = 'force-dynamic';

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

  // Load user data from Blob
  const [manifest, discoveriesData] = await Promise.all([
    getUserManifest(user.id),
    getUserDiscoveries(user.id),
  ]);

  const contexts = sortContexts(
    (manifest?.contexts ?? []).filter(c => isContextActive(c)),
  );
  const discoveries = discoveriesData?.discoveries ?? [];

  // Group discoveries by context
  const byContext = new Map<string, Discovery[]>();
  for (const ctx of contexts) {
    byContext.set(
      ctx.key,
      discoveries.filter(d => d.contextKey === ctx.key),
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
