import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { put, list, del } from '@vercel/blob';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';
import { getSavedDiscoveryIds } from '../../../_lib/discovery-write';
import type { Discovery, DiscoveryType, PlaceIdStatus } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'users';

const VALID_TYPES = new Set<string>([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

const CONTEXT_KEY_RE = /^(trip|outing|radar):.+$/;

interface IncomingDiscovery {
  name?: string;
  city?: string;
  contextKey?: string;
  type?: string;
  googleTypes?: string | string[];  // Google Places primaryType or types array
  place_id?: string;
  address?: string;
  rating?: number;
  source?: string;
  match?: number;
  heroImage?: string;
}

/** Map Google Places API primaryType/types to Compass DiscoveryType */
const GOOGLE_TYPE_MAP: Record<string, DiscoveryType> = {
  // Galleries / Art
  art_gallery: 'gallery', gallery: 'gallery', museum: 'museum',
  // Nightlife
  bar: 'bar', night_club: 'bar', pub: 'bar', brewery: 'bar', wine_bar: 'bar',
  cocktail_bar: 'bar', sports_bar: 'bar', comedy_club: 'bar',
  // Food
  restaurant: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe', bakery: 'cafe',
  food: 'restaurant', meal_takeaway: 'restaurant', meal_delivery: 'restaurant',
  // Culture
  performing_arts_theater: 'theatre', theater: 'theatre', cinema: 'experience',
  movie_theater: 'experience', movie_theatre: 'experience',
  // Music
  music_venue: 'music-venue', concert_hall: 'music-venue', jazz_club: 'music-venue',
  live_music_venue: 'music-venue', karaoke: 'music-venue',
  // Outdoors
  park: 'park', national_park: 'park', state_park: 'park', playground: 'park',
  beach: 'park', nature_reserve: 'park', campground: 'park',
  // Architecture / Sights
  tourist_attraction: 'experience', amusement_park: 'experience',
  aquarium: 'experience', zoo: 'experience', botanical_garden: 'park',
  // Shopping
  shopping_mall: 'shop', store: 'shop', book_store: 'shop', clothing_store: 'shop',
  // Accommodation
  lodging: 'hotel', hotel: 'hotel', motel: 'hotel',
  // Development
  real_estate_agency: 'development',
};

function mapGoogleType(types: string | string[] | undefined, name?: string): DiscoveryType {
  const typeList = Array.isArray(types) ? types : (types ? [types] : []);

  // Try each Google type in the map
  for (const t of typeList) {
    const lower = t.toLowerCase().replace(/ /g, '_');
    if (GOOGLE_TYPE_MAP[lower]) return GOOGLE_TYPE_MAP[lower];
  }

  // Name-based fallback
  return inferType(name);
}

function inferType(name?: string): DiscoveryType {
  if (!name) return 'restaurant';
  const lower = name.toLowerCase();
  if (/gallery|fine art/.test(lower)) return 'gallery';
  if (/museum|biennial/.test(lower)) return 'museum';
  if (/cinema|nitehawk|film house|movie theater|imax/.test(lower)) return 'experience';
  if (/roller.*arts|roller.*rink|skating|makerspace/.test(lower)) return 'experience';
  if (/house of yes|concert hall|music.*hall|jazz.*club|nublu|the rex\b/.test(lower)) return 'music-venue';
  if (/brewery|brew.*collective|brew.*co\b/.test(lower)) return 'bar';
  if (/bar|wine|cocktail|pub\b/.test(lower)) return 'bar';
  if (/caf[eé]|coffee|bakery/.test(lower)) return 'cafe';
  if (/theatre|theater|comedy|improv/.test(lower)) return 'theatre';
  if (/park|garden|beach|preserve/.test(lower)) return 'park';
  if (/hotel|inn\b|hostel/.test(lower)) return 'hotel';
  if (/market|grocer|butcher/.test(lower)) return 'grocery';
  if (/shop|store|book/.test(lower)) return 'shop';
  return 'restaurant';
}

function determinePlaceIdStatus(placeId?: string): PlaceIdStatus {
  if (!placeId) return 'missing';
  if (placeId.startsWith('ChIJ') || placeId.startsWith('Eh')) return 'verified';
  if (placeId.startsWith('pending') || placeId.startsWith('PENDING')) return 'pending';
  return 'verified';
}

/** Normalise place name for dedup matching */
function normaliseName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Merge discoveries by place_id: keep the one with more data (description, address, rating) */
function mergeByPlaceId(discoveries: unknown[]): unknown[] {
  const seen = new Map<string, number>(); // "place_id:contextKey" → index
  const result: unknown[] = [];
  for (const d of discoveries) {
    const rec = d as Record<string, unknown>;
    const pid = rec.place_id as string | undefined;
    const ctx = (rec.contextKey as string) ?? "";
    if (pid) {
      const k = `${pid}:${ctx}`;
      if (seen.has(k)) {
        const existingIdx = seen.get(k)!;
        const existing = result[existingIdx] as Record<string, unknown>;
        // Keep whichever has more data
        const incomingScore = [rec.description, rec.address, rec.rating].filter(Boolean).length;
        const existingScore = [existing.description, existing.address, existing.rating].filter(Boolean).length;
        if (incomingScore > existingScore) {
          result[existingIdx] = d;
        }
        continue;
      }
      seen.set(k, result.length);
    }
    result.push(d);
  }
  return result;
}

/**
 * Read raw discoveries from Blob WITHOUT normalization.
 * This preserves the exact data — critical for safe read-merge-write.
 */
async function readRawDiscoveries(userId: string): Promise<unknown[]> {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) return [];
    const res = await fetch(blob.url);
    if (!res.ok) return [];
    const data = await res.json();
    // Handle both formats: raw array or { discoveries: [...] }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.discoveries)) return data.discoveries;
    return [];
  } catch {
    return [];
  }
}

/**
 * Write discoveries to Blob. Includes safety checks.
 */
async function writeDiscoveries(userId: string, discoveries: unknown[]): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
  // Delete existing
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) await del(existing.url);
  } catch { /* ignore */ }

  const payload = { discoveries, updatedAt: new Date().toISOString() };
  await put(blobPath, JSON.stringify(payload, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

// GET: retrieve user discoveries
export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const discoveries = await readRawDiscoveries(userId);
  return NextResponse.json({ discoveries, count: discoveries.length });
}

// POST: APPEND discoveries (read-merge-write, never overwrite)
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;

  // Also support API key auth for agent pushes
  const authHeader = request.headers.get('authorization');
  const apiUserId = authHeader?.startsWith('Bearer ')
    ? request.headers.get('x-user-id') ?? undefined
    : undefined;

  const targetUserId = userId ?? apiUserId;
  if (!targetUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = getUserById(targetUserId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let body: { discoveries?: IncomingDiscovery[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = body.discoveries;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: 'discoveries[] required' }, { status: 400 });
  }

  // ═══════════════════════════════════════════════════════
  // SAFETY: Read raw Blob data directly — no normalization
  // ═══════════════════════════════════════════════════════
  const existingRaw = await readRawDiscoveries(targetUserId);
  const existingCount = existingRaw.length;

  // Build name-based index for dedup: normalised_name:contextKey → index
  const existingByName = new Map<string, number>();
  for (let idx = 0; idx < existingRaw.length; idx++) {
    const rec = existingRaw[idx] as Record<string, unknown>;
    const name = rec.name as string | undefined;
    const ctx = (rec.contextKey as string) ?? "";
    if (name) {
      const normKey = `${normaliseName(name)}:${ctx}`;
      existingByName.set(normKey, idx);
    }
  }

  // Also build place_id index for fallback dedup
  const existingPlaceIds = new Set<string>();
  for (const d of existingRaw) {
    const rec = d as Record<string, unknown>;
    const pid = rec.place_id as string | undefined;
    const ctx = (rec.contextKey as string) ?? "";
    if (pid) {
      existingPlaceIds.add(`${pid}:${ctx}`);
    }
  }

  const newItems: Discovery[] = [];
  let duplicates = 0;
  let upgraded = 0;
  const errors: string[] = [];

  for (let i = 0; i < incoming.length; i++) {
    const item = incoming[i]!;

    // Validate required fields
    if (!item.name) { errors.push(`[${i}] missing name`); continue; }
    if (!item.city) { errors.push(`[${i}] missing city`); continue; }
    if (!item.contextKey) { errors.push(`[${i}] missing contextKey`); continue; }
    if (!CONTEXT_KEY_RE.test(item.contextKey)) {
      errors.push(`[${i}] invalid contextKey format: ${item.contextKey}`);
      continue;
    }

    // Validate/infer type — priority: explicit valid type > Google types > name inference
    let type: DiscoveryType;
    if (item.type && VALID_TYPES.has(item.type)) {
      type = item.type as DiscoveryType;
    } else if (item.googleTypes) {
      type = mapGoogleType(item.googleTypes, item.name);
    } else if (item.type) {
      // Try the Google type map even for non-standard type strings
      type = mapGoogleType(item.type, item.name);
    } else {
      type = inferType(item.name);
    }

    // Name-based dedup + upgrade logic
    const normKey = `${normaliseName(item.name)}:${item.contextKey}`;
    const existingIdx = existingByName.get(normKey);

    if (existingIdx !== undefined) {
      // Something with this name+context already exists
      const existingRec = existingRaw[existingIdx] as Record<string, unknown>;
      const existingHasPlaceId = !!existingRec.place_id;
      const incomingHasPlaceId = !!item.place_id;

      if (incomingHasPlaceId && !existingHasPlaceId) {
        // Upgrade: incoming has place_id, existing doesn't → replace
        const upgradedRec = { ...existingRec, ...item, id: existingRec.id };
        existingRaw[existingIdx] = upgradedRec;
        existingPlaceIds.add(`${item.place_id}:${item.contextKey}`);
        upgraded++;
      } else {
        // Discard incoming (both have place_id, or incoming has none, or both have none)
        duplicates++;
      }
      continue;
    }

    // Fallback: also check place_id dedup (current logic)
    const dedupeKey = `${item.place_id ?? item.name}:${item.contextKey}`;
    if (existingPlaceIds.has(dedupeKey)) {
      duplicates++;
      continue;
    }

    const discovery: Discovery = {
      id: `disc_${Date.now()}_${i}`,
      place_id: item.place_id || undefined,
      name: item.name,
      address: item.address,
      city: item.city,
      type,
      rating: item.rating,
      contextKey: item.contextKey,
      source: item.source ?? 'disco:push',
      discoveredAt: new Date().toISOString(),
      match: item.match,
      placeIdStatus: determinePlaceIdStatus(item.place_id),
      heroImage: item.heroImage,
    };

    newItems.push(discovery);
    if (item.place_id) {
      existingPlaceIds.add(`${item.place_id}:${item.contextKey}`);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Merge by place_id: keep entry with more data
  // ═══════════════════════════════════════════════════════
  const merged = mergeByPlaceId([...existingRaw, ...newItems]);

  // ═══════════════════════════════════════════════════════
  // SAFETY #204: Saved items are IMMUTABLE — never removed
  // ═══════════════════════════════════════════════════════
  const savedIds = await getSavedDiscoveryIds(targetUserId);
  const mergedIds = new Set(merged.map(d => (d as Record<string, unknown>).id as string));
  const missingSaved: string[] = [];
  for (const savedId of savedIds) {
    if (!mergedIds.has(savedId)) {
      missingSaved.push(savedId);
    }
  }
  if (missingSaved.length > 0) {
    // Re-add any saved items that would be lost
    for (const d of existingRaw) {
      const rec = d as Record<string, unknown>;
      if (missingSaved.includes(rec.id as string) && !mergedIds.has(rec.id as string)) {
        merged.push(d);
        mergedIds.add(rec.id as string);
      }
    }
    console.warn(`[discoveries] Protected ${missingSaved.length} saved items from removal for ${targetUserId}`);
  }

  // Allow shrink only if it's due to mergeByPlaceId (not data loss)
  // Original existing count + new items - duplicates should never be less than merged
  const expectedMin = existingCount + newItems.length - duplicates;
  if (merged.length < expectedMin) {
    console.error(`[discoveries] SAFETY BLOCK: would shrink ${existingCount} → ${merged.length} for ${targetUserId}. Refusing to write.`);
    return NextResponse.json({
      error: 'Safety check failed: write would reduce discovery count',
      existingCount,
      wouldWrite: merged.length,
    }, { status: 409 });
  }

  if (newItems.length > 0 || upgraded > 0) {
    await writeDiscoveries(targetUserId, merged);
    console.log(`[discoveries] ${newItems.length} added, ${upgraded} upgraded for ${targetUserId}. ${existingCount} → ${merged.length}`);
  }

  return NextResponse.json({
    added: newItems.length,
    upgraded,
    duplicates,
    errors,
    previousCount: existingCount,
    total: merged.length,
  });
}
