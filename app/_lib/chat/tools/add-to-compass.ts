/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 */

import { setUserData, getUserData } from '../../user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../types';
import { resolveCity } from './resolve-city';
import { put, head } from '@vercel/blob';

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
 * Fetch photo for a place using Google Places API with fallback chain.
 * Returns the blob URL if successful, null otherwise.
 * Uses a 5 second timeout.
 */
async function fetchPhotoForPlace(placeId: string): Promise<string | null> {
  const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!PLACES_API_KEY) return null;

  const blobPath = `place-photos/${placeId}/1.jpg`;

  // Check if already exists
  try {
    const existing = await head(blobPath);
    if (existing) return existing.url;
  } catch {
    // Doesn't exist, need to fetch
  }

  let photoBuffer: ArrayBuffer | null = null;

  // ---- Try 1: Google Places Photo API (v1) ----
  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos,location&key=${PLACES_API_KEY}`,
      {
        headers: { 'X-Goog-Api-Key': PLACES_API_KEY, 'Content-Type': 'application/json' },
      }
    );

    if (detailsRes.ok) {
      const details = await detailsRes.json();
      const photos = details.photos;
      const location = details.location;

      if (photos && Array.isArray(photos) && photos.length > 0 && location) {
        const photoName = photos[0].name;
        const photoRes = await fetch(
          `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${PLACES_API_KEY}`
        );

        if (photoRes.ok) {
          photoBuffer = await photoRes.arrayBuffer();
        }
      }

      // If Places photos failed but we have location, try Street View
      if (!photoBuffer && location) {
        const lat = location.latitude;
        const lng = location.longitude;

        // ---- Try 2: Google Street View ----
        const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${lat},${lng}&key=${PLACES_API_KEY}`;
        const streetViewRes = await fetch(streetViewUrl);

        if (streetViewRes.ok) {
          const contentType = streetViewRes.headers.get('content-type') || '';
          if (contentType.includes('image')) {
            photoBuffer = await streetViewRes.arrayBuffer();
          }
        }

        // ---- Try 3: Google Static Map ----
        if (!photoBuffer) {
          const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=800x600&maptype=roadmap&markers=color:red|${lat},${lng}&key=${PLACES_API_KEY}`;
          const staticMapRes = await fetch(staticMapUrl);

          if (staticMapRes.ok) {
            const contentType = staticMapRes.headers.get('content-type') || '';
            if (contentType.includes('image')) {
              photoBuffer = await staticMapRes.arrayBuffer();
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[add_to_compass] fetchPhoto: Places API error:', e);
  }

  // If no photo found, return null
  if (!photoBuffer) return null;

  // Upload to Vercel Blob
  try {
    const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
    });
    return uploaded.url;
  } catch (e) {
    console.error('[add_to_compass] fetchPhoto: Blob upload error:', e);
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

    // Fix #211: If the discovery has a place_id, fetch photo SYNCHRONOUSLY
    // with a 5 second timeout. If fetch fails, save without heroImage.
    if (input.place_id) {
      try {
        const photoPromise = fetchPhotoForPlace(input.place_id);
        const timeoutPromise = new Promise<string | null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );
        heroImage = await Promise.race([photoPromise, timeoutPromise]) || undefined;
      } catch (e) {
        console.error('[add_to_compass] Failed to fetch photo:', e);
        // Save without heroImage - it will be filtered from display until photo is available
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
