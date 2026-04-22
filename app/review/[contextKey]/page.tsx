import Link from 'next/link';
import { getCurrentUser } from '../../_lib/user';
import { getEffectiveDerivedUserDiscoveries, getEffectiveUserManifest } from '../../_lib/effective-user-data';
import { getHeroImage } from '../../_lib/image-url.server';
import type { Discovery } from '../../_lib/types';
import { loadMonitorInventory } from '../../_lib/monitor-inventory';
import { buildHotSignalMap, getHotSignalLabel, isRecentHotSignal, type HotCardSignal } from '../../_lib/hot-intelligence';
import ReviewContextClient from '../../_components/ReviewContextClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ contextKey: string }>;
}

function enrichDiscoveriesWithImageMinimums(discoveries: Discovery[]): Discovery[] {
  return discoveries.map((discovery) => {
    const heroImage = getHeroImage(discovery.place_id, discovery.heroImage);
    return heroImage ? { ...discovery, heroImage } : discovery;
  });
}

export default async function ReviewContextPage({ params }: Props) {
  const { contextKey: encodedKey } = await params;
  const contextKey = decodeURIComponent(encodedKey);
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <p className="text-muted"><Link href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</Link> to review.</p>
      </main>
    );
  }

  const [manifest, discoveriesData, inventory] = await Promise.all([
    getEffectiveUserManifest(user.id),
    getEffectiveDerivedUserDiscoveries(user.id),
    loadMonitorInventory(user.id),
  ]);

  const context = manifest?.contexts.find(c => c.key === contextKey);
  const discoveries = enrichDiscoveriesWithImageMinimums(
    (discoveriesData?.discoveries ?? []).filter(d => {
      if (d.contextKey !== contextKey) return false;
      // Only show fully-built discoveries (must have name + address or description or rating)
      if (!d.name || d.name === 'Unknown Place') return false;
      const rec = d as unknown as Record<string, unknown>;
      const hasAddress = !!(rec.address as string);
      const hasDescription = !!(rec.description || rec.summary);
      const hasRating = d.rating != null && d.rating > 0;
      return hasAddress || hasDescription || hasRating;
    })
  );

  if (!context) {
    return (
      <main className="page">
        <p className="text-muted">Context not found.</p>
      </main>
    );
  }

  const signalById = buildHotSignalMap(inventory.entries);
  const signalByPlaceId: Record<string, HotCardSignal> = {};
  const recentSignals = discoveries
    .map((discovery) => {
      const placeId = discovery.place_id ?? discovery.id;
      const signal = signalById.get(placeId);
      if (!signal || signal.contextKey !== context.key || !isRecentHotSignal(signal)) return null;
      signalByPlaceId[placeId] = signal;
      return {
        placeId,
        name: discovery.name,
        significanceLevel: signal.significanceLevel ?? 'notable',
        label: getHotSignalLabel(signal) ?? 'Fresh signal',
        lastObservedAt: signal.lastObservedAt,
      };
    })
    .filter((value): value is {
      placeId: string;
      name: string;
      significanceLevel: NonNullable<HotCardSignal['significanceLevel']>;
      label: string;
      lastObservedAt?: string;
    } => Boolean(value))
    .sort((a, b) => {
      const timeA = a.lastObservedAt ? new Date(a.lastObservedAt).getTime() : 0;
      const timeB = b.lastObservedAt ? new Date(b.lastObservedAt).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 6);

  return (
    <ReviewContextClient
      userId={user.id}
      context={context}
      discoveries={discoveries}
      recentSignals={recentSignals}
      signalByPlaceId={signalByPlaceId}
    />
  );
}
