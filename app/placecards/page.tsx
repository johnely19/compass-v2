import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
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

function loadIndex(): Record<string, IndexEntry> {
  const indexPath = path.join(process.cwd(), 'data', 'placecards', 'index.json');
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, IndexEntry>;
  } catch {
    return {};
  }
}

function loadCardData(placeId: string): CardData {
  const cardPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
  if (!existsSync(cardPath)) return {};
  try {
    return JSON.parse(readFileSync(cardPath, 'utf8')) as CardData;
  } catch {
    return {};
  }
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
}

export default async function PlacecardsPage() {
  const user = await getCurrentUser();
  const index = loadIndex();

  // Build enriched card data with city and rating
  const cards: PlaceCardData[] = Object.entries(index).map(([placeId, entry]) => {
    const cardData = loadCardData(placeId);
    const city = cardData.identity?.city ?? '';
    const rating = extractRating(cardData.narrative?.summary ?? null);

    return {
      placeId,
      name: entry.name,
      type: entry.type,
      city,
      rating,
    };
  });

  // Get available types from the data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  return <PlacecardsBrowseClient cards={cards} availableTypes={availableTypes} userId={user?.id} />;
}
