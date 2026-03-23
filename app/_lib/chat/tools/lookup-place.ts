/**
 * Google Places lookup tool implementation.
 * Provides place verification and details for the Compass Concierge.
 */

export interface PlaceResult {
  displayName?: { text?: string } | null;
  id?: string;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  websiteUri?: string;
}

/**
 * Look up a place on Google Maps/Places.
 * @param query - Place name and city (e.g. "Published on Main Vancouver")
 * @returns Formatted place details or error message
 */
export async function lookupPlace(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Stub - return placeholder when no API key
    return `📍 Google Places lookup not configured. (Query: "${query}")\n\nTo enable place lookup, add GOOGLE_PLACES_API_KEY to your environment.`;
  }

  try {
    const url = `https://places.googleapis.com/v1/places:searchText`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.businessStatus,places.websiteUri,places.googleMapsUri',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 3 }),
    });
    if (!res.ok) return `Places error: ${res.status}`;
    const data = await res.json();
    const places = data.places || [];
    if (places.length === 0) return 'No places found.';
    return places
      .map((p: PlaceResult) => {
        const lines = [`📍 ${p.displayName?.text || 'Unknown'}`];
        if (p.id) lines.push(`   Place ID: ${p.id}`);
        if (p.formattedAddress) lines.push(`   Address: ${p.formattedAddress}`);
        if (p.rating) lines.push(`   Rating: ${p.rating}★ (${p.userRatingCount || '?'} reviews)`);
        if (p.priceLevel) lines.push(`   Price: ${p.priceLevel}`);
        if (p.businessStatus) lines.push(`   Status: ${p.businessStatus}`);
        if (p.websiteUri) lines.push(`   Web: ${p.websiteUri}`);
        return lines.join('\n');
      })
      .join('\n\n');
  } catch (e) {
    return `Places lookup failed: ${e}`;
  }
}
