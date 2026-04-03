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

  // 3. Get photo reference from Google Places
  let photoBuffer: ArrayBuffer | null = null;

  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos&key=${PLACES_API_KEY}`,
      {
        headers: { 'X-Goog-Api-Key': PLACES_API_KEY, 'Content-Type': 'application/json' },
      }
    );

    if (!detailsRes.ok) {
      return new NextResponse(TRANSPARENT_PIXEL, {
        status: 404,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
      });
    }

    const details = await detailsRes.json();
    const photos = details.photos;

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return new NextResponse(TRANSPARENT_PIXEL, {
        status: 404,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
      });
    }

    const photoName = photos[0].name;

    // 4. Fetch the photo at 400px width
    const photoRes = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${PLACES_API_KEY}`
    );

    if (!photoRes.ok) {
      return new NextResponse(TRANSPARENT_PIXEL, {
        status: 404,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': CACHE_CONTROL },
      });
    }

    photoBuffer = await photoRes.arrayBuffer();
  } catch (e) {
    console.error('[place-photo] Google Places API error:', e);
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