/* ============================================================
   Compass v2 — Card Adapter
   Transforms V1 card.json format to V2 PlaceCard type
   ============================================================ */

import type { PlaceCard, DiscoveryType } from './types';
import { mergePlaceCardImages } from './image-url';

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
 * Optionally pass manifest data to include image URLs.
 */
export function adaptCard(raw: Record<string, unknown>, manifest?: Record<string, unknown>): PlaceCard {
  const manifestImages = manifest?.images as Array<{ path?: string; category?: string }> | undefined;

  // Already V2 format?
  if (raw.data && typeof raw.data === 'object' && raw.type) {
    const v2 = raw as unknown as PlaceCard;
    return {
      ...v2,
      data: {
        ...v2.data,
        images: mergePlaceCardImages(v2.data.images, manifestImages),
      },
    };
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

  // Preserve prose blocks (title + body) for rich rendering
  const narrativeBlocks: { title: string; body: string }[] = [];

  for (const block of blocks) {
    // Prose blocks — the actual narrative content
    if (block.title && block.body && typeof block.body === 'string') {
      narrativeBlocks.push({ title: block.title as string, body: block.body as string });
    }

    if (block.type === 'highlights' && Array.isArray(block.items)) {
      for (const item of block.items) {
        if (typeof item === 'string') highlights.push(item);
        else if (item.name) highlights.push(item.name);
      }
    }

    if (block.type === 'hours' && block.hours) {
      hours = block.hours as Record<string, string>;
    }

    // Also read hours from identity if available
    if (!hours && Array.isArray((v1.identity as Record<string, unknown>)?.hours)) {
      const rawHours = (v1.identity as Record<string, unknown>).hours as string[];
      hours = {};
      for (const h of rawHours) {
        const parts = h.split(': ');
        const day = parts[0];
        if (parts.length >= 2 && day) hours[day] = parts.slice(1).join(': ');
      }
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

  // Also pull identity fields not in blocks (including enriched fields from #58)
  const ident = v1.identity as Record<string, unknown> ?? {};
  const identityFields: Record<string, unknown> = {
    phone: ident.phone,
    website: ident.website,
    price_level: ident.price_level,
    rating: ident.rating,
    user_rating_count: ident.user_rating_count,
    review_count: ident.review_count,
    menu_link: ident.menu_link,
    lat: ident.lat,
    lng: ident.lng,
    address: ident.address,
    city: ident.city,
    hours: ident.hours, // enriched by #58
  };
  if (!rating && identityFields.rating) rating = identityFields.rating as number;
  if (!reviewCount && identityFields.user_rating_count) reviewCount = identityFields.user_rating_count as number;
  if (!reviewCount && identityFields.review_count) reviewCount = identityFields.review_count as number;

  // Also lift vibe blocks from narrative.blocks (enriched by #60)
  for (const block of blocks) {
    if (block.type === 'vibe' && block.title && block.body) {
      narrativeBlocks.push({ title: block.title as string, body: block.body as string });
    }
  }

  const mergedImages = mergePlaceCardImages(images, manifestImages);

  return {
    place_id: v1.place_id ?? identity.place_id ?? '',
    name: identity.name,
    type: normalizeType(identity.type),
    data: {
      description,
      highlights,
      hours,
      images: mergedImages,
      ...(menu ? { menu } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(reviewCount !== undefined ? { reviewCount } : {}),
      ...(narrativeBlocks.length > 0 ? { narrativeBlocks } : {}),
      // Identity fields
      ...(identityFields.phone ? { phone: identityFields.phone } : {}),
      ...(identityFields.website ? { website: identityFields.website } : {}),
      ...(identityFields.price_level !== undefined ? { price_level: identityFields.price_level } : {}),
      ...(identityFields.menu_link ? { menu_link: identityFields.menu_link } : {}),
      ...(identityFields.lat ? { lat: identityFields.lat } : {}),
      ...(identityFields.lng ? { lng: identityFields.lng } : {}),
      ...(identityFields.address ? { address: identityFields.address } : {}),
      ...(identityFields.city ? { city: identityFields.city } : {}),
      ...(identityFields.hours ? { hours: identityFields.hours as string[] | Record<string, string> } : {}),
    },
  };
}
