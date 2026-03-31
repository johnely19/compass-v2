import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { getUserDiscoveries, getUserManifest } from '../_lib/user-data';
import { PlaceCardStore } from '../_lib/place-card-store';
import PlacecardsBrowseClient from './PlacecardsBrowseClient';

export const dynamic = 'force-dynamic';

export interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
  contextLabel: string;
  heroImage?: string;
}

export default async function PlacecardsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header"><h1>My Places</h1></div>
        <p className="text-muted">Sign in to see your discovered places.</p>
      </main>
    );
  }

  // Load user discoveries and context manifest in parallel
  const [discData, manifest] = await Promise.all([
    getUserDiscoveries(user.id),
    getUserManifest(user.id),
  ]);

  const discoveries = discData?.discoveries ?? [];

  // Build context label lookup from manifest
  const contextLabels: Record<string, string> = {};
  if (manifest?.contexts) {
    for (const ctx of manifest.contexts) {
      contextLabels[ctx.key] = `${ctx.emoji || '📋'} ${ctx.label}`;
    }
  }

  // Deduplicate by place_id (first occurrence wins)
  const seen = new Set<string>();
  const cards: PlaceCardData[] = [];

  for (const d of discoveries) {
    const placeId = d.place_id || d.id;
    if (seen.has(placeId)) continue;
    seen.add(placeId);

    cards.push({
      placeId,
      name: d.name,
      type: d.type,
      city: d.city || '',
      rating: d.rating ?? null,
      contextKey: d.contextKey,
      contextLabel: contextLabels[d.contextKey] || d.contextKey,
      heroImage: d.heroImage,
    });
  }

  // Get available types from user's data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  // Get unique contexts for filtering
  const contextSet = new Map<string, string>();
  for (const c of cards) {
    if (!contextSet.has(c.contextKey)) {
      contextSet.set(c.contextKey, c.contextLabel);
    }
  }
  const availableContexts = Array.from(contextSet.entries()).map(([key, label]) => ({ key, label }));

  // Owner admin: build global card list for the admin toggle
  let adminCards: PlaceCardData[] | undefined;
  if (user.isOwner) {
    const index = await PlaceCardStore.getIndex();
    adminCards = Object.entries(index).map(([placeId, entry]) => ({
      placeId,
      name: entry.name,
      type: entry.type as DiscoveryType,
      city: '',
      rating: null,
      contextKey: '',
      contextLabel: '',
    }));
  }

  return (
    <PlacecardsBrowseClient
      cards={cards}
      availableTypes={availableTypes}
      availableContexts={availableContexts}
      userId={user.id}
      isOwner={user.isOwner}
      adminCards={adminCards}
    />
  );
}
