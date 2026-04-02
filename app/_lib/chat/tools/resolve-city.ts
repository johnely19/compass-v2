/**
 * Resolve the actual city for a place from Google Places API data.
 *
 * The LLM sometimes sets city from the active trip context (e.g. "Haliburton, Ontario")
 * instead of the place's real location. This module derives the correct city from:
 * 1. Google Places API address_components (authoritative)
 * 2. Parsing the formatted address string (fallback)
 * 3. Parsing the address field already on the discovery (last resort)
 *
 * See: https://github.com/johnely19/compass-v2/issues/187
 */

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlaceDetails {
  addressComponents?: AddressComponent[];
  formattedAddress?: string;
}

/**
 * Extract city from Google Places address components.
 */
function cityFromComponents(components: AddressComponent[]): string | null {
  // Priority: locality > sublocality > administrative_area_level_1
  for (const type of ['locality', 'sublocality_level_1', 'sublocality', 'postal_town']) {
    const match = components.find(c => c.types?.includes(type));
    if (match?.longText) return match.longText;
  }
  // For places in boroughs (e.g. Brooklyn → New York)
  const admin2 = components.find(c => c.types?.includes('administrative_area_level_2'));
  if (admin2?.longText) return admin2.longText;
  return null;
}

/**
 * Extract state/province from address components.
 */
function stateFromComponents(components: AddressComponent[]): string | null {
  const match = components.find(c => c.types?.includes('administrative_area_level_1'));
  return match?.longText || null;
}

/**
 * Parse city from a formatted address string.
 * Handles formats like:
 *   "123 Main St, Toronto, ON M5V 1A1, Canada"
 *   "456 Broadway, New York, NY 10012, USA"
 *   "789 Queen St W, Toronto, Ontario, Canada"
 */
function cityFromAddress(address: string): string | null {
  if (!address) return null;

  // Split by comma, trim
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Typical format: [street, city, state/postal, country]
  // The city is usually the second-to-last part before state+postal or the second part
  // Strategy: skip the first part (street), look for a part that is a city name
  // (not a postal code, not a country, not a state abbreviation)

  // For North American addresses: city is typically parts[1] if 3+ parts
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 3] || parts[1];
    // Skip if it looks like a street address (starts with number)
    if (candidate && !/^\d/.test(candidate)) {
      // Clean up: remove postal codes that may be appended
      const cleaned = candidate.replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i, '').trim(); // CA postal
      return cleaned || null;
    }
  }

  // Fallback: second part
  if (parts.length >= 2 && !/^\d/.test(parts[1]!)) {
    return parts[1]!;
  }

  return null;
}

/**
 * Resolve the real city for a place using Google Places API.
 * Falls back to parsing the address string if API call fails.
 *
 * @param placeId - Google Place ID
 * @param fallbackAddress - Address string to parse as fallback
 * @param llmCity - City provided by the LLM (used only as last resort)
 * @returns Resolved city string
 */
export async function resolveCity(
  placeId?: string | null,
  fallbackAddress?: string | null,
  llmCity?: string,
): Promise<string> {
  // 1. Try Google Places API if we have a place_id
  if (placeId) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (apiKey) {
      try {
        const url = `https://places.googleapis.com/v1/places/${placeId}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'addressComponents,formattedAddress',
          },
        });
        if (res.ok) {
          const data: PlaceDetails = await res.json();

          // Try address components first (most reliable)
          if (data.addressComponents?.length) {
            const city = cityFromComponents(data.addressComponents);
            const state = stateFromComponents(data.addressComponents);
            if (city) {
              const resolved = state ? `${city}, ${state}` : city;
              console.log(`[resolve-city] place_id=${placeId} → "${resolved}" (from address_components)`);
              return resolved;
            }
          }

          // Try formatted address parsing
          if (data.formattedAddress) {
            const city = cityFromAddress(data.formattedAddress);
            if (city) {
              console.log(`[resolve-city] place_id=${placeId} → "${city}" (from formattedAddress)`);
              return city;
            }
          }
        }
      } catch (e) {
        console.warn(`[resolve-city] Places API failed for ${placeId}:`, e);
      }
    }
  }

  // 2. Try parsing the fallback address
  if (fallbackAddress) {
    const city = cityFromAddress(fallbackAddress);
    if (city) {
      console.log(`[resolve-city] → "${city}" (from address string)`);
      return city;
    }
  }

  // 3. Last resort: use LLM-provided city
  console.log(`[resolve-city] → "${llmCity || 'unknown'}" (from LLM, no better source)`);
  return llmCity || 'unknown';
}
