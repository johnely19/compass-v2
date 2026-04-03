/**
 * POST /api/internal/fetch-photo
 * Fetches a photo for a place using Google Places API with fallback chain.
 * Uploads the result to Vercel Blob at place-photos/{placeId}/1.jpg
 *
 * Body: { placeId: string }
 * Returns: { ok: true, photoUrl: blobUrl }
 */
import { NextRequest, NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

export async function POST(req: NextRequest) {
  if (!PLACES_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_API_KEY not configured' },
      { status: 501 }
    );
  }

  let body: { placeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { placeId } = body;
  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
  }

  const blobPath = `place-photos/${placeId}/1.jpg`;

  // Check if already exists
  try {
    const existing = await head(blobPath);
    if (existing) {
      return NextResponse.json({
        ok: true,
        photoUrl: existing.url,
        cached: true,
      });
    }
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
    console.error('[fetch-photo] Places API error:', e);
  }

  // If no photo found, return 404
  if (!photoBuffer) {
    return NextResponse.json({ error: 'No photo found for this place' }, { status: 404 });
  }

  // Upload to Vercel Blob
  try {
    const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
    });

    return NextResponse.json({
      ok: true,
      photoUrl: uploaded.url,
    });
  } catch (e) {
    console.error('[fetch-photo] Blob upload error:', e);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
}