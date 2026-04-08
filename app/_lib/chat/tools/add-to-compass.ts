/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 *
 * Photo fetching is intentionally SKIPPED here — the nightly enrich-photos
 * cron handles that. Doing synchronous photo fetches during chat would add
 * 8s per place, causing timeouts when the AI adds multiple discoveries in
 * a single turn. Places without photos are filtered from display until enriched.
 */

import { setUserData, getUserData } from '../../user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../types';
import { resolveCity } from './resolve-city';

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
 * Photos are not fetched synchronously — they're enriched by the nightly cron.
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

    // Derive city from actual place data, not from LLM context (fixes #187)
    const resolvedCity = await resolveCity(input.place_id, input.address, input.city);

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: resolvedCity,
      type: input.category,
      rating: input.rating,
      heroImage: undefined,
      images: undefined,
      contextKey: input.contextKey || '',
      source: 'chat:recommendation',
      discoveredAt: new Date().toISOString(),
      placeIdStatus: input.place_id ? 'verified' : 'missing',
    };

    // Get existing discoveries and append — read-modify-write
    // Note: concurrent tool calls in the same turn may cause last-write-wins
    // on the Blob. This is acceptable for the chat flow (order not critical).
    let existingData: UserDiscoveries | null = null;
    try {
      existingData = await getUserData<'discoveries'>(userId, 'discoveries');
    } catch {
      // No existing data — start fresh
    }

    const discoveries = existingData?.discoveries || [];

    // Dedup by name+city to prevent double-adds if the LLM retries
    const isDuplicate = discoveries.some(
      d => d.name === input.name && d.city === resolvedCity
    );
    if (isDuplicate) {
      console.log(`[add_to_compass] Skipping duplicate: "${input.name}" (${resolvedCity})`);
      return `"${input.name}" is already in your Compass.`;
    }

    // Add new discovery at front
    discoveries.unshift(discovery);

    // Save back to blob
    await setUserData(userId, 'discoveries', {
      discoveries,
      updatedAt: new Date().toISOString(),
    });

    console.log(`[add_to_compass] ✅ Added "${input.name}" (${resolvedCity}) for user ${userId}`);

    // Build response URLs
    const mapsUrl = input.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${input.place_id}`
      : (input.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(input.name + ' ' + resolvedCity)}`
        : null);

    return `✅ Added "${input.name}" to Compass!${mapsUrl ? ` [Map](${mapsUrl})` : ''} Photos will load shortly.`;
  } catch (e) {
    console.error('[add_to_compass] Failed:', e);
    return `Failed to add "${input.name}" to Compass: ${e}`;
  }
}
