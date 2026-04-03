/**
 * POST /api/internal/fetch-photo
 * Fetches multiple photos for a place using Google Places API with fallback chain.
 * Uploads results to Vercel Blob at place-photos/{placeId}/{n}.jpg (1-indexed)
 *
 * Body: { placeId: string, count?: number } (count defaults to 6, max 10)
 * Returns: { ok: true, photoUrl: string, photos: PlaceImage[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';
import { classifyPhotos } from '../../../_lib/image-classifier';
import type { DiscoveryType, PlaceImage } from '../../../_lib/types';

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!PLACES_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_API_KEY not configured' },
      { status: 501 }
    );
  }

  let body: { placeId?: string; count?: number; placeType?: DiscoveryType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { placeId, count, placeType } = body;
  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
  }

  // Default place type if not provided
  const type: DiscoveryType = placeType || 'restaurant';

  const photoCount = Math.min(count || 6, 10);

  // Check if we already have photos cached - check first photo path
  const firstBlobPath = `place-photos/${placeId}/1.jpg`;
  try {
    const existing = await head(firstBlobPath);
    if (existing) {
      // Load all cached photos
      const cachedPhotos: PlaceImage[] = [];
      for (let i = 1; i <= photoCount; i++) {
        const blobPath = `place-photos/${placeId}/${i}.jpg`;
        try {
          const photo = await head(blobPath);
          if (photo) {
            cachedPhotos.push({
              url: photo.url,
              role: 'general', // Will be classified below
              source: 'google-places',
            });
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      // Classify cached photos based on place type
      if (cachedPhotos.length > 0) {
        const rawPhotos = cachedPhotos.map(p => ({ url: p.url, source: p.source }));
        const classified = classifyPhotos(rawPhotos, type);

        for (let i = 0; i < cachedPhotos.length; i++) {
          const classifiedPhoto = classified[i];
          if (classifiedPhoto) {
            cachedPhotos[i]!.role = classifiedPhoto.role;
          }
        }
      }

      return NextResponse.json({
        ok: true,
        photoUrl: cachedPhotos[0]?.url || '',
        photos: cachedPhotos,
        cached: true,
      });
    }
  } catch {
    // Doesn't exist, need to fetch
  }

  // Fetch photos from Google Places
  let photos: PlaceImage[] = [];
  let location: { latitude: number; longitude: number } | null = null;

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
      const placePhotos = details.photos;
      location = details.location;

      if (placePhotos && Array.isArray(placePhotos) && placePhotos.length > 0) {
        const numToFetch = Math.min(photoCount, placePhotos.length);

        for (let i = 0; i < numToFetch; i++) {
          const photoName = placePhotos[i].name;
          const photoRes = await fetch(
            `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${PLACES_API_KEY}`
          );

          if (photoRes.ok) {
            const photoBuffer = await photoRes.arrayBuffer();
            const blobPath = `place-photos/${placeId}/${i + 1}.jpg`;

            try {
              const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
                access: 'public',
                addRandomSuffix: false,
                contentType: 'image/jpeg',
              });

              // Collect all photos for classification
              photos.push({
                url: uploaded.url,
                role: 'general', // Will be classified after loop
                source: 'google-places',
              });
            } catch (e) {
              console.error('[fetch-photo] Blob upload error:', e);
            }
          }

          // Add 100ms delay between photo fetches
          if (i < numToFetch - 1) {
            await delay(100);
          }
        }

        // Classify photos based on place type
        if (photos.length > 0) {
          const rawPhotos = photos.map(p => ({ url: p.url, source: p.source }));
          const classified = classifyPhotos(rawPhotos, type);

          // Update roles with classified values
          for (let i = 0; i < photos.length; i++) {
            const classifiedPhoto = classified[i];
            if (classifiedPhoto) {
              photos[i]!.role = classifiedPhoto.role;
            }
          }
        }
      }

      // If no Google Places photos but we have location, try fallback
      if (photos.length === 0 && location) {
        const fallbackPhoto = await fetchFallbackImage(location, placeId);
        if (fallbackPhoto) {
          photos.push(fallbackPhoto);
        }
      }
    }
  } catch (e) {
    console.error('[fetch-photo] Places API error:', e);
  }

  // If still no photos, try fallback (e.g., if location was retrieved but photos failed)
  if (photos.length === 0 && location) {
    const fallbackPhoto = await fetchFallbackImage(location, placeId);
    if (fallbackPhoto) {
      photos.push(fallbackPhoto);
    }
  }

  // Classify any remaining photos
  if (photos.length > 0) {
    const rawPhotos = photos.map(p => ({ url: p.url, source: p.source }));
    const classified = classifyPhotos(rawPhotos, type);

    for (let i = 0; i < photos.length; i++) {
      const classifiedPhoto = classified[i];
      if (classifiedPhoto) {
        photos[i]!.role = classifiedPhoto.role;
      }
    }
  }

  // If no photo found at all, return 404
  if (photos.length === 0) {
    return NextResponse.json({ error: 'No photo found for this place' }, { status: 404 });
  }

  const firstPhoto = photos[0];
  if (!firstPhoto) {
    return NextResponse.json({ error: 'No photo found for this place' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    photoUrl: firstPhoto.url,
    photos,
  });
}

async function fetchFallbackImage(
  location: { latitude: number; longitude: number },
  placeId: string
): Promise<PlaceImage | null> {
  const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!PLACES_API_KEY) return null;

  const lat = location.latitude;
  const lng = location.longitude;

  // ---- Try 2: Google Street View ----
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${lat},${lng}&key=${PLACES_API_KEY}`;
  const streetViewRes = await fetch(streetViewUrl);

  if (streetViewRes.ok) {
    const contentType = streetViewRes.headers.get('content-type') || '';
    if (contentType.includes('image')) {
      const photoBuffer = await streetViewRes.arrayBuffer();
      const blobPath = `place-photos/${placeId}/1.jpg`;

      try {
        const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'image/jpeg',
        });

        return {
          url: uploaded.url,
          role: 'hero',
          source: 'street-view',
        };
      } catch (e) {
        console.error('[fetch-photo] Street View blob upload error:', e);
      }
    }
  }

  // ---- Try 3: Google Static Map ----
  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=800x600&maptype=roadmap&markers=color:red|${lat},${lng}&key=${PLACES_API_KEY}`;
  const staticMapRes = await fetch(staticMapUrl);

  if (staticMapRes.ok) {
    const contentType = staticMapRes.headers.get('content-type') || '';
    if (contentType.includes('image')) {
      const photoBuffer = await staticMapRes.arrayBuffer();
      const blobPath = `place-photos/${placeId}/1.jpg`;

      try {
        const uploaded = await put(blobPath, new Blob([photoBuffer], { type: 'image/jpeg' }), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'image/jpeg',
        });

        return {
          url: uploaded.url,
          role: 'hero',
          source: 'static-map',
        };
      } catch (e) {
        console.error('[fetch-photo] Static Map blob upload error:', e);
      }
    }
  }

  return null;
}