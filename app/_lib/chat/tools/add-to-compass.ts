/**
 * Add to Compass tool implementation.
 * Saves recommended places to the user's Compass app.
 *
 * Photo fetching is intentionally SKIPPED here — the nightly enrich-photos
 * cron handles that. Doing synchronous photo fetches during chat would add
 * 8s per place, causing timeouts when the AI adds multiple discoveries in
 * a single turn. Places without photos are filtered from display until enriched.
 */

import { setUserData, getUserData, getUserManifest } from '../../user-data';
import type { Discovery, DiscoveryType, PlaceImage, UserDiscoveries } from '../../types';
import { resolveCity } from './resolve-city';

const VALID_TYPES = new Set<DiscoveryType>([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

/** Normalize LLM-generated type strings to valid DiscoveryType values */
function normalizeType(raw: string): DiscoveryType {
  const t = raw.toLowerCase().replace(/_/g, '-').trim();
  if (VALID_TYPES.has(t as DiscoveryType)) return t as DiscoveryType;
  // Common LLM variants
  const map: Record<string, DiscoveryType> = {
    'live-music-venue': 'music-venue',
    'live-music': 'music-venue',
    'music-hall': 'music-venue',
    'concert-hall': 'music-venue',
    'specialty-shop': 'shop',
    'clothing-shop': 'shop',
    'retail': 'shop',
    'boutique': 'shop',
    'fine-dining': 'restaurant',
    'bistro': 'restaurant',
    'brasserie': 'restaurant',
    'gastropub': 'bar',
    'pub': 'bar',
    'cocktail-bar': 'bar',
    'wine-bar': 'bar',
    'resort': 'accommodation',
    'lodge': 'accommodation',
    'inn': 'accommodation',
    'hostel': 'accommodation',
    'b-and-b': 'accommodation',
    'bed-and-breakfast': 'accommodation',
    'art-gallery': 'gallery',
    'art-museum': 'museum',
    'natural-history-museum': 'museum',
    'neighborhood': 'neighbourhood',
    'district': 'neighbourhood',
    'area': 'neighbourhood',
    'national-park': 'park',
    'botanical-garden': 'park',
    'garden': 'park',
  };
  return map[t] || 'experience';
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
 * Photos are not fetched synchronously — they're enriched by the nightly cron.
 * @param userId - User identifier
 * @param input - Place details
 * @returns Confirmation message with links
 */
/**
 * Fire-and-forget photo enrichment. Fetches a hero image from Google Places
 * and patches the discovery in Blob. Runs after the discovery is saved so the
 * chat response isn't blocked.
 */
async function enrichPhotosAsync(userId: string, discoveryId: string, placeId: string): Promise<void> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return;

  try {
    // Fetch photo reference from Places API
    const url = `https://places.googleapis.com/v1/places/${placeId}`;
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'photos',
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    const photos = data.photos as Array<{ name: string }> | undefined;
    if (!photos?.length) return;

    // Get first photo as hero image
    const photoName = photos[0]!.name;
    const photoRes = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`
    );
    if (!photoRes.ok) return;
    const photoUrl = photoRes.url; // Google redirects to the actual image URL

    // Update the discovery in Blob with the hero image
    const discData = await getUserData<'discoveries'>(userId, 'discoveries');
    if (!discData?.discoveries) return;
    const disc = discData.discoveries.find(d => d.id === discoveryId);
    if (!disc) return;
    disc.heroImage = photoUrl;
    await setUserData(userId, 'discoveries', {
      ...discData,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[add_to_compass/photos] ✅ Enriched "${disc.name}" with hero image`);
  } catch (err) {
    console.warn(`[add_to_compass/photos] Failed for ${placeId}:`, err);
  }
}

export async function addToCompass(
  userId: string,
  input: AddToCompassInput,
): Promise<string> {
  try {
    // Generate unique ID for the discovery
    const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Derive city from actual place data, not from LLM context (fixes #187)
    const resolvedCity = await resolveCity(input.place_id, input.address, input.city);

    // Resolve contextKey against the user's manifest to prevent LLM key mismatches
    // e.g. LLM may hallucinate "trip:tokyo-november-2024" when the real key is "trip:tokyo-november-2027"
    let resolvedContextKey = input.contextKey || '';
    if (resolvedContextKey) {
      try {
        const manifest = await getUserManifest(userId);
        if (manifest?.contexts?.length) {
          const exact = manifest.contexts.find(c => c.key === resolvedContextKey);
          if (!exact) {
            // Fuzzy match: compare slug portions (strip year variants)
            const inputSlug = resolvedContextKey.split(':').slice(1).join(':');
            const inputBase = inputSlug.replace(/-\d{4}$/, '');
            const match = manifest.contexts.find(c => {
              const cSlug = c.key.split(':').slice(1).join(':');
              const cBase = cSlug.replace(/-\d{4}$/, '');
              return cBase === inputBase || cSlug.includes(inputBase) || inputBase.includes(cBase);
            });
            if (match) {
              console.log(`[add_to_compass] Fixed contextKey: "${resolvedContextKey}" → "${match.key}"`);
              resolvedContextKey = match.key;
            }
          }
        }
      } catch {
        // Fall through with original key
      }
    }

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: resolvedCity,
      type: normalizeType(input.category),
      rating: input.rating,
      description: input.why, // 'why' is the concierge's reason — store as description for card display
      heroImage: undefined,
      images: undefined,
      contextKey: resolvedContextKey,
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

    // Fire-and-forget photo enrichment — doesn't block the chat response
    if (input.place_id) {
      enrichPhotosAsync(userId, discoveryId, input.place_id).catch(err =>
        console.warn(`[add_to_compass] Photo enrichment failed (non-blocking): ${err}`)
      );
    }

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
