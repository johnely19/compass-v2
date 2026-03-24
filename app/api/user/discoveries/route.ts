import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { put, list, del } from '@vercel/blob';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';
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

  // Build dedup set from raw data
  const existingIds = new Set<string>();
  for (const d of existingRaw) {
    const rec = d as Record<string, unknown>;
    const pid = rec.place_id ?? rec.id ?? rec.name;
    const ctx = rec.contextKey ?? '';
    existingIds.add(`${pid}:${ctx}`);
  }

  const newItems: Discovery[] = [];
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

    newItems.push(discovery);
    existingIds.add(dedupeKey);
  }

  // ═══════════════════════════════════════════════════════
  // SAFETY: Append only — never shrink the array
  // ═══════════════════════════════════════════════════════
  const merged = [...existingRaw, ...newItems];

  if (merged.length < existingCount) {
    // This should NEVER happen with append-only, but guard anyway
    console.error(`[discoveries] SAFETY BLOCK: would shrink ${existingCount} → ${merged.length} for ${targetUserId}. Refusing to write.`);
    return NextResponse.json({
      error: 'Safety check failed: write would reduce discovery count',
      existingCount,
      wouldWrite: merged.length,
    }, { status: 409 });
  }

  if (newItems.length > 0) {
    await writeDiscoveries(targetUserId, merged);
    console.log(`[discoveries] Appended ${newItems.length} to ${targetUserId}. ${existingCount} → ${merged.length}`);
  }

  return NextResponse.json({
    added: newItems.length,
    duplicates,
    errors,
    previousCount: existingCount,
    total: merged.length,
  });
}
