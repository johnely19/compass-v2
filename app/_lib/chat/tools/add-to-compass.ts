/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 */

import { setUserData, getUserData } from '../../user-data';
import type { Discovery, DiscoveryType, PlaceImage, UserDiscoveries } from '../../types';
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
 * Fetch multiple photos for a place using the internal API.
 * Returns the photos array if successful, null otherwise.
 * Uses an 8 second timeout.
 */
async function fetchPhotosForPlace(placeId: string): Promise<PlaceImage[] | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${baseUrl}/api/internal/fetch-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId, count: 6 }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return data.photos || null;
    }
    return null;
  } catch (e) {
    console.error('[add_to_compass] Failed to fetch photos:', e);
    return null;
  }
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

    // Derive city from actual place data, not from LLM context (fixes #187)
    const resolvedCity = await resolveCity(input.place_id, input.address, input.city);

    let heroImage: string | undefined = undefined;
    let images: PlaceImage[] | undefined = undefined;

    // Fix #211: If the discovery has a place_id, fetch photos SYNCHRONOUSLY
    // with an 8 second timeout. If fetch fails, save without images.
    if (input.place_id) {
      try {
        const photoPromise = fetchPhotosForPlace(input.place_id);
        const timeoutPromise = new Promise<PlaceImage[] | null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 8000)
        );
        const photos = await Promise.race([photoPromise, timeoutPromise]);
        if (photos && photos.length > 0 && photos[0]) {
          heroImage = photos[0].url;
          images = photos;
        }
      } catch (e) {
        console.warn('[add_to_compass] Failed to fetch photos:', e);
        // Save without images - it will be filtered from display until photos are available
      }
    }

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: resolvedCity,
      type: input.category,
      rating: input.rating,
      heroImage,
      images,
      contextKey: input.contextKey || '',
      source: 'chat:recommendation',
      discoveredAt: new Date().toISOString(),
      placeIdStatus: input.place_id ? 'verified' : 'missing',
    };

    // Get existing discoveries
    let existingData: UserDiscoveries | null = null;
    try {
      existingData = await getUserData<'discoveries'>(userId, 'discoveries');
    } catch {
      // No existing data
    }

    const discoveries = existingData?.discoveries || [];

    // Add new discovery
    discoveries.unshift(discovery);

    // Save back to blob
    await setUserData(userId, 'discoveries', {
      discoveries,
      updatedAt: new Date().toISOString(),
    });

    console.log(`[add_to_compass] ✅ Added "${input.name}" (${resolvedCity}) for user ${userId}`);

    // Build response URLs
    const compassUrl = input.place_id
      ? `https://compass-ai-agent.vercel.app/placecards/${input.place_id}`
      : null;
    const mapsUrl = input.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${input.place_id}`
      : (input.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(input.name + ' ' + resolvedCity)}`
        : null);

    return `✅ Added "${input.name}" to Compass! Links: compass=${compassUrl || 'pending'} maps=${mapsUrl || 'pending'}`;
  } catch (e) {
    console.error('[add_to_compass] Failed:', e);
    return `Failed to add to Compass: ${e}`;
  }
}
