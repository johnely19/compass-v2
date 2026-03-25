import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { getManifestHeroImage } from '../_lib/image-url';
import HotClient from './HotClient';

export const dynamic = 'force-dynamic';

interface IndexEntry {
  name: string;
  type: DiscoveryType;
}

interface CardData {
  built?: string | null;
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

// Check if a card is a "new opening" based on summary content
function isNewOpening(summary: string | null): boolean {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  // Use specific phrases only — avoid false positives like "New York" or "new to the area"
  return (
    lower.includes('just opened') ||
    lower.includes('soft-opened') ||
    lower.includes('soft open') ||
    lower.includes('now open') ||
    lower.includes('opening soon') ||
    lower.includes('grand opening') ||
    /opened\s+(in\s+)?(march|april|may|june|july|august|2026)/.test(lower) ||
    /new\s+(restaurant|bar|café|cafe|spot|opening|location|arrival)/.test(lower)
  );
}

interface HotPlaceCard {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  isNewOpening: boolean;
  addedAt: string | null;
  heroImage: string | null;
}

export default async function HotPage() {
  const user = await getCurrentUser();
  const index = loadIndex();

  // Build enriched card data with city, new opening detection, and date
  const cards: HotPlaceCard[] = Object.entries(index).map(([placeId, entry]) => {
    const cardData = loadCardData(placeId);
    const city = cardData.identity?.city ?? '';
    const summary = cardData.narrative?.summary ?? null;
    const isNew = isNewOpening(summary);
    // Use built date as the date signal for sorting (when card was created)
    const addedAt = cardData.built ?? null;

    const heroImage = getManifestHeroImage(placeId);

    return {
      placeId,
      name: entry.name,
      type: entry.type,
      city,
      isNewOpening: isNew,
      addedAt,
      heroImage,
    };
  });

  // Get available types from the data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  return <HotClient cards={cards} availableTypes={availableTypes} userId={user?.id} />;
}
