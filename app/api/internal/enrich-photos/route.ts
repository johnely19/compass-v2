/**
 * POST /api/internal/enrich-photos
 * Fetches Google Places photos for discoveries missing heroImages.
 * Requires GOOGLE_PLACES_SERVER_KEY env var (server-only, unrestricted key).
 * Body: { userId?: string, limit?: number, placeIds?: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { list, put } from '@vercel/blob';
import type { Discovery } from '../../../_lib/types';
import { recordDiscoveryHistoryEvent } from '../../../_lib/discovery-history';

const PLACES_SERVER_KEY = process.env.GOOGLE_PLACES_SERVER_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

export async function POST(req: NextRequest) {
  if (!PLACES_SERVER_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_SERVER_KEY not configured. Add a server-side (unrestricted) Places API key.' },
      { status: 501 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const userId = body.userId || 'john';
  const limit = body.limit || 20;
  const onlyPlaceIds: string[] | undefined = body.placeIds;

  // Load discoveries
  const { blobs } = await list({ prefix: `users/${userId}/discoveries` });
  if (blobs.length === 0) return NextResponse.json({ error: 'No discoveries found' }, { status: 404 });

  const matchedBlob = blobs.find(b => b.pathname === `users/${userId}/discoveries.json`) ?? blobs[0];
  const blobUrl = matchedBlob!.url;
  const res = await fetch(blobUrl);
  const raw = await res.json();
  const discoveries: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.discoveries || [];
  const previousDiscoveries = discoveries.map((d) => ({ ...d })) as unknown as Discovery[];

  // Find candidates
  const candidates = discoveries.filter(d => {
    if (!d.place_id) return false;
    if (onlyPlaceIds && !onlyPlaceIds.includes(d.place_id as string)) return false;
    return !d.heroImage;
  }).slice(0, limit);

  const results = { fetched: 0, failed: 0, errors: [] as string[] };

  for (const d of candidates) {
    const placeId = d.place_id as string;
    const photoPath = `place-photos/${placeId}/photos/1.jpg`;

    try {
      // Get photo reference from Places API
      const detailsRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${PLACES_SERVER_KEY}`
      );
      const details = await detailsRes.json();
      if (details.status !== 'OK' || !details.result?.photos?.length) {
        results.failed++;
        results.errors.push(`${d.name}: ${details.status}`);
        continue;
      }

      const photoRef = details.result.photos[0].photo_reference;
      const photoRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photoreference=${photoRef}&key=${PLACES_SERVER_KEY}`
      );
      if (!photoRes.ok) {
        results.failed++;
        results.errors.push(`${d.name}: photo fetch ${photoRes.status}`);
        continue;
      }

      const photoBuffer = await photoRes.arrayBuffer();
      const uploaded = await put(photoPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'image/jpeg',
      });

      d.heroImage = uploaded.url;
      results.fetched++;

      await new Promise(r => setTimeout(r, 100));
    } catch (e: unknown) {
      results.failed++;
      results.errors.push(`${d.name}: ${(e as Error).message}`);
    }
  }

  // Save updated discoveries
  const { blobs: toDelete } = await list({ prefix: `users/${userId}/discoveries` });
  for (const b of toDelete) {
    await fetch(b.url, { method: 'DELETE' }).catch(() => {});
  }
  await put(`users/${userId}/discoveries.json`, JSON.stringify(discoveries), {
    access: 'public',
    addRandomSuffix: false,
  });

  try {
    await recordDiscoveryHistoryEvent({
      userId,
      source: 'api/internal/enrich-photos',
      previous: previousDiscoveries,
      next: discoveries as unknown as Discovery[],
    });
  } catch {
    // best-effort history only
  }

  return NextResponse.json({
    ...results,
    coverage: `${discoveries.filter(d => d.heroImage).length}/${discoveries.length}`,
  });
}
