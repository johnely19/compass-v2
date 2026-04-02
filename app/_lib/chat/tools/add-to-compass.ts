/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 */

import { setUserData, getUserData } from '../../user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../types';

interface PlaceAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlaceDetails {
  addressComponents?: PlaceAddressComponent[];
  formattedAddress?: string;
}

/**
 * Extract city from Google Place address components.
 * Looks for locality (city) or falls back to parsing formatted_address.
 */
function extractCityFromPlace(place: GooglePlaceDetails): string | null {
  // Try to find locality in address components
  if (place.addressComponents) {
    for (const component of place.addressComponents) {
      if (component.types?.includes('locality')) {
        return component.longText || component.shortText || null;
      }
    }
    // Fallback to sublocality
    for (const component of place.addressComponents) {
      if (component.types?.includes('sublocality')) {
        return component.longText || component.shortText || null;
      }
    }
  }
  // Fallback: parse from formatted_address
  if (place.formattedAddress) {
    const parts = place.formattedAddress.split(',');
    if (parts.length >= 2) {
      return parts[0].trim().split(' ').slice(-1)[0] || parts[1]?.trim() || null;
    }
  }
  return null;
}

/**
 * Fetch place details from Google Places API to get actual address.
 */
async function fetchPlaceDetails(placeId: string): Promise<GooglePlaceDetails | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://places.googleapis.com/v1/${placeId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'addressComponents,formattedAddress',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

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

    // If we have a place_id, fetch actual address to get the real city
    let city = input.city;
    let address = input.address;
    if (input.place_id) {
      const placeDetails = await fetchPlaceDetails(input.place_id);
      if (placeDetails) {
        const extractedCity = extractCityFromPlace(placeDetails);
        if (extractedCity) {
          city = extractedCity;
          address = placeDetails.formattedAddress || input.address;
        }
      }
    }

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: address,
      city: city,
      type: input.category,
      rating: input.rating,
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

    console.log(`[add_to_compass] ✅ Added "${input.name}" (${city}) for user ${userId}`);

    // Build response URLs
    const compassUrl = input.place_id
      ? `https://compass-ai-agent.vercel.app/placecards/${input.place_id}`
      : null;
    const mapsUrl = input.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${input.place_id}`
      : (input.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(input.name + ' ' + city)}`
        : null);

    return `✅ Added "${input.name}" to Compass! Links: compass=${compassUrl || 'pending'} maps=${mapsUrl || 'pending'}`;
  } catch (e) {
    console.error('[add_to_compass] Failed:', e);
    return `Failed to add to Compass: ${e}`;
  }
}
