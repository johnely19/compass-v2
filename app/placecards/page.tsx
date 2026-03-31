import { getCurrentUser } from '../_lib/user';
import { getUserDiscoveries } from '../_lib/user-data';
import { getUserManifest } from '../_lib/user-data';
import type { DiscoveryType, Context } from '../_lib/types';
import MyPlacesClient from './MyPlacesClient';

export const dynamic = 'force-dynamic';

export interface MyPlaceCard {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
  heroImage: string | null;
}

export default async function PlacecardsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header"><h1>My Places</h1></div>
        <p className="text-muted">Sign in to see your discoveries.</p>
      </main>
    );
  }

  // Get user's discoveries
  const discData = await getUserDiscoveries(user.id);
  const discoveries = discData?.discoveries ?? [];

  // Get user's contexts for filter labels
  const manifestData = await getUserManifest(user.id);
  const contexts: Context[] = manifestData?.contexts ?? [];

  // Build card list from user's actual discoveries
  // Deduplicate by placeId (keep first occurrence — most recent context)
  const seen = new Set<string>();
  const cards: MyPlaceCard[] = [];

  for (const d of discoveries) {
    const placeId = d.place_id || d.id;
    // Allow same place in different contexts (unique by placeId + contextKey)
    const dedupeKey = `${placeId}::${d.contextKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    cards.push({
      placeId,
      name: d.name,
      type: d.type as DiscoveryType,
      city: d.city || '',
      rating: d.rating ?? null,
      contextKey: d.contextKey,
      heroImage: d.heroImage ?? null,
    });
  }

  // Get unique context keys from discoveries
  const contextKeysInUse = [...new Set(cards.map(c => c.contextKey))];

  // Build context options for the filter (only contexts that have discoveries)
  const contextOptions = contextKeysInUse.map(key => {
    const ctx = contexts.find(c => c.key === key);
    return {
      key,
      label: ctx?.label || key.replace(/^(trip|outing|radar):/, '').replace(/-/g, ' '),
      emoji: ctx?.emoji || '📍',
    };
  });

  return (
    <MyPlacesClient
      cards={cards}
      contextOptions={contextOptions}
      userId={user.id}
      isOwner={user.isOwner ?? false}
      totalDiscoveries={discoveries.length}
    />
  );
}
