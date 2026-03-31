import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { PlaceCardStore } from '../_lib/place-card-store';
import { getUserDiscoveries, getUserManifest } from '../_lib/user-data';
import PlacecardsBrowseClient from './PlacecardsBrowseClient';

export const dynamic = 'force-dynamic';

interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
  contextLabel?: string;
  heroImage?: string;
}

interface CardData {
  identity?: {
    city?: string | null;
  };
  narrative?: {
    summary?: string | null;
  };
}

// Extract rating from summary string (e.g., "5.0★" or "4.5★")
function extractRating(summary: string | null): number | null {
  if (!summary) return null;
  const match = summary.match(/(\d+\.?\d*)\s*★/);
  if (!match) return null;
  const value = match[1];
  if (!value) return null;
  return parseFloat(value);
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

  // Load user discoveries and manifest (for context labels)
  const [discData, manifestData] = await Promise.all([
    getUserDiscoveries(user.id),
    getUserManifest(user.id),
  ]);

  const discoveries = discData?.discoveries ?? [];

  // Build context label map from manifest
  const contextLabels: Record<string, string> = {};
  if (manifestData?.contexts) {
    for (const ctx of manifestData.contexts) {
      contextLabels[ctx.key] = `${ctx.emoji || ''} ${ctx.label}`.trim();
    }
  }

  // Build card list from user's actual discoveries
  // Deduplicate by placeId (keep the most recent discovery per place)
  const seenPlaceIds = new Map<string, PlaceCardData>();

  for (const d of discoveries) {
    const placeId = d.place_id || d.id;
    const contextKey = d.contextKey || 'radar:toronto-experiences';
    const rating = d.rating != null ? Number(d.rating) : null;

    const card: PlaceCardData = {
      placeId,
      name: d.name,
      type: d.type as DiscoveryType,
      city: d.city || '',
      rating: !isNaN(rating!) && rating !== null ? rating : null,
      contextKey,
      contextLabel: contextLabels[contextKey] || contextKey,
      heroImage: d.heroImage,
    };

    // Keep first occurrence (discoveries are ordered by discoveredAt)
    if (!seenPlaceIds.has(placeId)) {
      seenPlaceIds.set(placeId, card);
    }
  }

  const userCards = Array.from(seenPlaceIds.values());

  // For owner: also build the global admin cards
  let adminCards: PlaceCardData[] = [];
  if (user.isOwner) {
    const index = await PlaceCardStore.getIndex();
    adminCards = await Promise.all(
      Object.entries(index).map(async ([placeId, entry]) => {
        const cardData = await PlaceCardStore.getCard(placeId) as CardData | null;
        const city = cardData?.identity?.city ?? '';
        const rating = extractRating(cardData?.narrative?.summary ?? null);
        return {
          placeId,
          name: entry.name,
          type: entry.type as DiscoveryType,
          city,
          rating,
          contextKey: 'admin:index',
          contextLabel: '🗂️ Admin Index',
        };
      })
    );
  }

  // Get available types from user's data
  const typeSet = new Set<DiscoveryType>(userCards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  // Get available contexts from user's data
  const contextKeys = Array.from(new Set(userCards.map((c) => c.contextKey)));
  const availableContexts = contextKeys.map(key => ({
    key,
    label: contextLabels[key] || key,
  }));

  return (
    <PlacecardsBrowseClient
      cards={userCards}
      adminCards={user.isOwner ? adminCards : undefined}
      availableTypes={availableTypes}
      availableContexts={availableContexts}
      userId={user.id}
      isOwner={user.isOwner}
    />
  );
}
