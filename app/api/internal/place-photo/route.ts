/**
 * GET /api/internal/place-photo
 * Photo proxy with caching: checks Blob first, fetches from Google Places if needed.
 *
 * Query params: ?placeId=ChIJ...
 * Returns: 302 redirect to Blob URL or transparent pixel
 */
import { NextRequest, NextResponse } from 'next/server';
import { head, put } from '@vercel/blob';

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Transparent 1x1 GIF (base64)
const TRANSPARENT_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Cache for 24 hours
const CACHE_CONTROL = 'public, max-age=86400';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get('placeId');

  if (!placeId) {
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 404,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
    });
  }

  const blobPath = `place-photos/${placeId}/1.jpg`;

  // 1. Check Vercel Blob cache
  try {
    const existing = await head(blobPath);
    if (existing) {
      return NextResponse.redirect(existing.url, {
        status: 302,
        headers: { 'Cache-Control': CACHE_CONTROL },
      });
    }
  } catch {
    // Doesn't exist, need to fetch from Google Places
  }

  // 2. Fetch from Google Places API if no API key
  if (!PLACES_API_KEY) {
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 404,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
    });
  }

  // 3. Fetch photo with full fallback chain: Places → Street View → Static Map
  let photoBuffer: ArrayBuffer | null = null;

  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos,location`,
      {
        headers: { 'X-Goog-Api-Key': PLACES_API_KEY, 'Content-Type': 'application/json' },
      }
    );

    if (detailsRes.ok) {
      const details = await detailsRes.json();
      const photos = details.photos;
      const location = details.location;

      // Try 1: Google Places photos
      if (photos?.length > 0) {
        const photoName = photos[0].name;
        const photoRes = await fetch(
          `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${PLACES_API_KEY}`
        );
        if (photoRes.ok) {
          photoBuffer = await photoRes.arrayBuffer();
        }
      }

      // Try 2: Street View (if we have location)
      if (!photoBuffer && location) {
        const { latitude: lat, longitude: lng } = location;
        const svRes = await fetch(
          `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${lat},${lng}&key=${PLACES_API_KEY}`
        );
        if (svRes.ok && svRes.headers.get('content-type')?.includes('image')) {
          photoBuffer = await svRes.arrayBuffer();
        }
      }

      // Try 3: Static Map (if we have location)
      if (!photoBuffer && location) {
        const { latitude: lat, longitude: lng } = location;
        const mapRes = await fetch(
          `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=800x600&maptype=roadmap&markers=color:red|${lat},${lng}&key=${PLACES_API_KEY}`
        );
        if (mapRes.ok && mapRes.headers.get('content-type')?.includes('image')) {
          photoBuffer = await mapRes.arrayBuffer();
        }
      }
    }
  } catch (e) {
    console.error('[place-photo] API error:', e);
  }

  // If no photo found after all fallbacks, return transparent pixel
  if (!photoBuffer) {
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 404,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
    });
  }

  // 5. Upload to Vercel Blob
  try {
    const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
    });

    return NextResponse.redirect(uploaded.url, {
      status: 302,
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch (e) {
    console.error('[place-photo] Blob upload error:', e);
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 500,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
    });
  }
}