/* ============================================================
   Compass v2 — Card Adapter
   Transforms V1 card.json format to V2 PlaceCard type
   ============================================================ */

import type { PlaceCard, DiscoveryType } from './types';

// V1 card.json structure
interface V1Card {
  place_id: string;
  source?: string;
  identity: {
    place_id?: string;
    name: string;
    city?: string;
    address?: string;
    type?: string;
  };
  discovery?: {
    text?: string;
    url?: string;
  };
  narrative?: {
    summary?: string;
    blocks?: V1Block[];
  };
}

interface V1Block {
  type: string;
  content?: string;
  items?: V1MenuItem[];
  images?: { url?: string; path?: string; caption?: string; category?: string }[];
  hours?: Record<string, string>;
  [key: string]: unknown;
}

interface V1MenuItem {
  name: string;
  price?: string;
  highlight?: boolean;
  description?: string;
}

const VALID_TYPES = new Set<string>([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

function normalizeType(raw?: string): DiscoveryType {
  if (!raw) return 'restaurant';
  if (VALID_TYPES.has(raw)) return raw as DiscoveryType;
  return 'restaurant';
}

/**
 * Adapt a V1 card.json (or V2 PlaceCard) into a V2 PlaceCard.
 * Handles both formats gracefully — if it's already V2, returns as-is.
 */
export function adaptCard(raw: Record<string, unknown>): PlaceCard {
  // Already V2 format?
  if (raw.data && typeof raw.data === 'object' && raw.type) {
    return raw as unknown as PlaceCard;
  }

  // V1 format
  const v1 = raw as unknown as V1Card;
  const identity = v1.identity ?? { name: 'Unknown' };
  const narrative = v1.narrative;
  const blocks = narrative?.blocks ?? [];

  // Extract data from V1 blocks
  const description = narrative?.summary ?? '';
  const highlights: string[] = [];
  let hours: Record<string, string> | undefined;
  const images: { path: string; category: string }[] = [];
  let menu: { category: string; items: { name: string; price?: string; highlight?: boolean }[] }[] | undefined;
  let rating: number | undefined;
  let reviewCount: number | undefined;

  for (const block of blocks) {
    if (block.type === 'highlights' && Array.isArray(block.items)) {
      for (const item of block.items) {
        if (typeof item === 'string') highlights.push(item);
        else if (item.name) highlights.push(item.name);
      }
    }

    if (block.type === 'hours' && block.hours) {
      hours = block.hours as Record<string, string>;
    }

    if (block.type === 'images' && Array.isArray(block.images)) {
      for (const img of block.images) {
        const imgPath = img.url ?? img.path;
        if (imgPath) {
          images.push({ path: imgPath, category: img.category ?? 'general' });
        }
      }
    }

    if (block.type === 'menu' && Array.isArray(block.items)) {
      if (!menu) menu = [];
      menu.push({
        category: (block.content as string) ?? 'Menu',
        items: block.items.map(i => ({
          name: i.name,
          price: i.price,
          highlight: i.highlight,
        })),
      });
    }

    if (block.type === 'rating') {
      rating = block.rating as number | undefined;
      reviewCount = block.reviewCount as number | undefined;
    }
  }

  return {
    place_id: v1.place_id ?? identity.place_id ?? '',
    name: identity.name,
    type: normalizeType(identity.type),
    data: {
      description,
      highlights,
      hours,
      images,
      ...(menu ? { menu } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(reviewCount !== undefined ? { reviewCount } : {}),
    },
  };
}
