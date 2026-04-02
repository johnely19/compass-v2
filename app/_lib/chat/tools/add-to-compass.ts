/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 *
 * Issue #204: Uses merge-only writes — discoveries are never lost.
 */

import { mergeAndWriteDiscoveries } from '../../discovery-write';
import type { Discovery, DiscoveryType } from '../../types';

export interface AddToCompassInput {
  name: string;
  city: string;
  neighborhood?: string;
  category: DiscoveryType;
  why: string;
  place_id?: string;
  rating?: number;
  address?: string;
  contextKey?: string;
}

/**
 * Add a recommended place to the user's Compass.
 * @param userId - User identifier
 * @param input - Place details
 * @returns Confirmation message with links
 */
export async function addToCompass(
  userId: string,
  input: AddToCompassInput,
): Promise<string> {
  try {
    // Generate unique ID for the discovery
    const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: input.city,
      type: input.category,
      rating: input.rating,
      contextKey: input.contextKey || '',
      source: 'chat:recommendation',
      discoveredAt: new Date().toISOString(),
      placeIdStatus: input.place_id ? 'verified' : 'missing',
    };

    // Merge-only write (never overwrites existing discoveries)
    const result = await mergeAndWriteDiscoveries(userId, [discovery]);

    console.log(`[add_to_compass] ✅ Added "${input.name}" (${input.city}) for user ${userId} (${result.added} new, ${result.duplicates} dupes)`);

    // Build response URLs
    const compassUrl = input.place_id
      ? `https://compass-ai-agent.vercel.app/placecards/${input.place_id}`
      : null;
    const mapsUrl = input.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${input.place_id}`
      : (input.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(input.name + ' ' + input.city)}`
        : null);

    return `✅ Added "${input.name}" to Compass! Links: compass=${compassUrl || 'pending'} maps=${mapsUrl || 'pending'}`;
  } catch (e) {
    console.error('[add_to_compass] Failed:', e);
    return `Failed to add to Compass: ${e}`;
  }
}
