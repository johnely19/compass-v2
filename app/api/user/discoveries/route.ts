import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';
import { getUserDiscoveries, setUserData } from '../../../_lib/user-data';
import type { Discovery, DiscoveryType, PlaceIdStatus, UserDiscoveries } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

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
  place_id?: string;
  address?: string;
  rating?: number;
  source?: string;
  match?: number;
  heroImage?: string;
}

function inferType(name?: string): DiscoveryType {
  if (!name) return 'restaurant';
  const lower = name.toLowerCase();
  if (/gallery|art\s/.test(lower)) return 'gallery';
  if (/museum/.test(lower)) return 'museum';
  if (/bar|wine|cocktail|brewery|pub\b/.test(lower)) return 'bar';
  if (/caf[eé]|coffee|bakery/.test(lower)) return 'cafe';
  if (/theatre|theater|comedy/.test(lower)) return 'theatre';
  if (/park|garden|beach/.test(lower)) return 'park';
  if (/hotel|inn\b|hostel/.test(lower)) return 'hotel';
  return 'restaurant';
}

function determinePlaceIdStatus(placeId?: string): PlaceIdStatus {
  if (!placeId) return 'missing';
  if (placeId.startsWith('ChIJ') || placeId.startsWith('Eh')) return 'verified';
  if (placeId.startsWith('pending') || placeId.startsWith('PENDING')) return 'pending';
  return 'verified';
}

// GET: retrieve user discoveries
export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const data = await getUserDiscoveries(userId);
  return NextResponse.json({ discoveries: data?.discoveries ?? [] });
}

// POST: add discoveries (from Disco agent or chat)
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

  // Load existing discoveries
  const existing = await getUserDiscoveries(targetUserId);
  const discoveries = existing?.discoveries ?? [];
  const existingIds = new Set(discoveries.map(d => `${d.place_id ?? d.id}:${d.contextKey}`));

  let added = 0;
  let duplicates = 0;
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

    // Validate/infer type
    let type: DiscoveryType;
    if (item.type && VALID_TYPES.has(item.type)) {
      type = item.type as DiscoveryType;
    } else {
      type = inferType(item.name);
      if (item.type) {
        console.log(`[discoveries] Inferred type '${type}' for '${item.name}' (sent: '${item.type}')`);
      }
    }

    // Dedup check
    const dedupeKey = `${item.place_id ?? item.name}:${item.contextKey}`;
    if (existingIds.has(dedupeKey)) {
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

    discoveries.push(discovery);
    existingIds.add(dedupeKey);
    added++;
  }

  // Save
  const updated: UserDiscoveries = {
    discoveries,
    updatedAt: new Date().toISOString(),
  };
  await setUserData(targetUserId, 'discoveries', updated);

  return NextResponse.json({ added, duplicates, errors, total: discoveries.length });
}
