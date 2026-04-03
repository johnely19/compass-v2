import { notFound } from 'next/navigation';
import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { PlaceCardStore } from '../_lib/place-card-store';
import PlacecardsBrowseClient from './PlacecardsBrowseClient';

export const dynamic = 'force-dynamic';

interface IndexEntry {
  name: string;
  type: DiscoveryType;
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

interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  heroImage: string | null;
}

export default async function PlacecardsPage() {
  const user = await getCurrentUser();

  // Places browse uses the global index — owner only
  if (!user?.isOwner) {
    return (
      <main className="page">
        <div className="page-header"><h1>Places</h1></div>
        <p className="text-muted">Coming soon.</p>
      </main>
    );
  }

  const index = await PlaceCardStore.getIndex();

  // Build enriched card data with city and rating
  // Note: During migration, we may fall back to local data for some cards
  const cards: PlaceCardData[] = await Promise.all(
    Object.entries(index).map(async ([placeId, entry]) => {
      const cardData = await PlaceCardStore.getCard(placeId) as CardData | null;
      const city = cardData?.identity?.city ?? '';
      const rating = extractRating(cardData?.narrative?.summary ?? null);

      return {
        placeId,
        name: entry.name,
        type: entry.type,
        city,
        rating,
        heroImage: `/api/internal/place-photo?placeId=${placeId}`,
      };
    })
  );

  // Get available types from the data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  return <PlacecardsBrowseClient cards={cards} availableTypes={availableTypes} userId={user?.id} />;
}
