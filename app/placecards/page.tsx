import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { getUserDiscoveries } from '../_lib/user-data';
import { PlaceCardStore } from '../_lib/place-card-store';
import PlacecardsBrowseClient from './PlacecardsBrowseClient';

export const dynamic = 'force-dynamic';

interface CardData {
  identity?: {
    city?: string | null;
  };
  narrative?: {
    summary?: string | null;
  };
}

// Extract rating from summary string (e.g., "5.0★" or "4.5★")
function extractRating(summary: string | null | undefined): number | null {
  if (!summary) return null;
  const match = summary.match(/(\d+\.?\d*)\s*★/);
  if (!match) return null;
  const value = match[1];
  if (!value) return null;
  return parseFloat(value);
}

export interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
}

export default async function PlacecardsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header"><h1>My Places</h1></div>
        <p className="text-muted">Sign in to see your places.</p>
      </main>
    );
  }

  // Load user's own discoveries
  const discData = await getUserDiscoveries(user.id);
  const discoveries = discData?.discoveries ?? [];

  // Deduplicate by place_id (keep last occurrence per place)
  const seen = new Map<string, typeof discoveries[0]>();
  for (const d of discoveries) {
    const key = d.place_id ?? d.id;
    seen.set(key, d);
  }
  const uniqueDiscoveries = Array.from(seen.values());

  // Build card list from user's discoveries
  // Try to enrich from filesystem card cache if available
  const cards: PlaceCardData[] = await Promise.all(
    uniqueDiscoveries.map(async (d) => {
      const placeId = d.place_id ?? d.id;

      // Optionally enrich with card data for city/rating if available
      let city = d.city ?? '';
      let rating = d.rating != null ? Number(d.rating) || null : null;

      if (d.place_id) {
        try {
          const cardData = await PlaceCardStore.getCard(d.place_id) as CardData | null;
          if (cardData?.identity?.city) city = cardData.identity.city;
          if (rating === null && cardData?.narrative?.summary) {
            rating = extractRating(cardData.narrative.summary);
          }
        } catch {
          // Card may not exist — that's fine
        }
      }

      return {
        placeId,
        name: d.name,
        type: d.type as DiscoveryType,
        city,
        rating,
        contextKey: d.contextKey,
      };
    })
  );

  // Get available types from the data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  // Get unique context keys for filtering
  const contextKeys = Array.from(new Set(cards.map((c) => c.contextKey))).sort();

  // Owner admin: also expose global index toggle
  const isOwner = user.isOwner ?? false;

  return (
    <PlacecardsBrowseClient
      cards={cards}
      availableTypes={availableTypes}
      contextKeys={contextKeys}
      userId={user.id}
      isOwner={isOwner}
    />
  );
}
