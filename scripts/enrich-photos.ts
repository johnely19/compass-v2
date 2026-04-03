/**
 * Enrichment script for type-specific photo roles.
 * Reads user discoveries, fetches photos from Google Places, classifies them,
 * and updates discoveries with role-classified photos.
 *
 * Usage: npx tsx scripts/enrich-photos.ts [--dry-run] [--user USR_XXX] [--type restaurant]
 */
import { list, put, del, head } from '@vercel/blob';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// Load env vars from .env.local
config({ path: join(process.cwd(), '.env.local') });

import type { Discovery, DiscoveryType, PlaceImage, ImageRole } from '../app/_lib/types';
import { classifyPhotos, getRequiredRoles, selectBestPhotos } from '../app/_lib/image-classifier';

interface User {
  id: string;
  name: string;
  code: string;
  city: string;
  isOwner: boolean;
  createdAt: string;
  active?: boolean;
}

interface Users {
  users: Record<string, User>;
}

interface Discoveries {
  discoveries: Discovery[];
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

if (!token) {
  console.error('Error: BLOB_READ_WRITE_TOKEN not set in .env.local');
  process.exit(1);
}

if (!googleApiKey) {
  console.error('Error: GOOGLE_PLACES_API_KEY not set in .env.local');
  process.exit(1);
}

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const userIndex = args.indexOf('--user');
const singleUser = userIndex !== -1 ? args[userIndex + 1] : null;
const typeIndex = args.indexOf('--type');
const targetTypes: DiscoveryType[] = typeIndex !== -1
  ? [args[typeIndex + 1] as DiscoveryType]
  : ['restaurant', 'bar', 'cafe'];

// Rate limiting (300ms between API calls)
let lastGoogleCall = 0;
let lastPhotoDownload = 0;

async function rateLimitedGoogleCall<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const elapsed = now - lastGoogleCall;
  if (elapsed < 300) {
    await new Promise(r => setTimeout(r, 300 - elapsed));
  }
  lastGoogleCall = Date.now();
  return fn();
}

async function rateLimitedPhotoDownload<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const elapsed = now - lastPhotoDownload;
  if (elapsed < 100) {
    await new Promise(r => setTimeout(r, 100 - elapsed));
  }
  lastPhotoDownload = Date.now();
  return fn();
}

/**
 * Check if discovery already has classifed roles (not just hero and general).
 */
function hasClassifiedRoles(discovery: Discovery): boolean {
  if (!discovery.images || discovery.images.length === 0) {
    return false;
  }

  const roles = new Set(discovery.images.map(img => img.role));
  const hasSpecificRoles =
    roles.has('exterior') ||
    roles.has('interior') ||
    roles.has('food') ||
    roles.has('drink') ||
    roles.has('water') ||
    roles.has('surroundings') ||
    roles.has('aerial') ||
    roles.has('detail');

  return hasSpecificRoles;
}

/**
 * Fetch place details from Google Places API to get photos.
 */
async function fetchGooglePlacePhotos(placeId: string): Promise<string[]> {
  const url = `https://places.googleapis.com/v1/places/${placeId}?fields=photos&key=${googleApiKey}`;

  const response = await rateLimitedGoogleCall(() =>
    fetch(url, {
      headers: {
        'X-Goog-Api-Key': googleApiKey!,
      },
    })
  );

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { photos?: { name: string }[] };

  if (!data.photos || data.photos.length === 0) {
    return [];
  }

  // Take up to 10 photos
  const photoRefs = data.photos.slice(0, 10).map(p => p.name);

  const photoUrls: string[] = [];

  for (const ref of photoRefs) {
    const mediaUrl = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=800&key=${googleApiKey}`;

    const mediaResponse = await rateLimitedPhotoDownload(() =>
      fetch(mediaUrl, {
        redirect: 'follow',
      })
    );

    if (mediaResponse.ok) {
      photoUrls.push(mediaResponse.url);
    }
  }

  return photoUrls;
}

/**
 * Upload photo to Blob and return the URL.
 */
async function uploadPhotoToBlob(
  placeId: string,
  n: number,
  photoUrl: string
): Promise<string> {
  const photoResponse = await rateLimitedPhotoDownload(() =>
    fetch(photoUrl)
  );

  if (!photoResponse.ok) {
    throw new Error(`Failed to fetch photo: ${photoResponse.status}`);
  }

  const arrayBuffer = await photoResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const blobPath = `place-photos/${placeId}/${n}.jpg`;

  const result = await put(blobPath, buffer, {
    token,
    contentType: 'image/jpeg',
    access: 'public',
  });

  return result.url;
}

/**
 * Main enrichment function.
 */
async function enrich() {
  // Read users.json
  const usersFile = readFileSync(join(process.cwd(), 'data/users.json'), 'utf-8');
  const usersData: Users = JSON.parse(usersFile);

  const users = Object.values(usersData.users);

  let totalUpdated = 0;
  const usersProcessed: string[] = [];

  for (const user of users) {
    // If --user flag specified, skip other users
    if (singleUser && user.id !== singleUser) {
      continue;
    }

    console.log(`User ${user.id}: processing...`);

    // Fetch user's discoveries from Blob
    const blobPrefix = `users/${user.id}/discoveries.json`;

    let discoveries: Discovery[] = [];

    try {
      const { blobs } = await list({ prefix: blobPrefix, limit: 1, token });
      const blob = blobs[0];
      if (!blob) {
        console.log(`  User ${user.id}: no discoveries found`);
        continue;
      }
      const response = await fetch(blob.url);
      if (response.ok) {
        const data = (await response.json()) as Discoveries;
        discoveries = data.discoveries || [];
      } else {
        console.error(`  Error fetching discoveries: ${response.status}`);
        continue;
      }
    } catch (error) {
      console.error(`  Error fetching discoveries: ${error}`);
      continue;
    }

    let userUpdated = 0;

    // Process each discovery with a place_id that needs enrichment
    for (const discovery of discoveries) {
      // Must have place_id
      if (!discovery.place_id) {
        continue;
      }

      // Must be one of the target types
      if (!targetTypes.includes(discovery.type)) {
        continue;
      }

      // Skip if already has classified roles
      if (hasClassifiedRoles(discovery)) {
        continue;
      }

      const placeId = discovery.place_id;

      // Fetch photos from Google Places API
      console.log(`  Fetching photos for ${discovery.name || placeId}...`);

      try {
        const photoUrls = await fetchGooglePlacePhotos(placeId);

        if (photoUrls.length === 0) {
          console.log(`  No photos available for ${discovery.name || placeId}`);
          continue;
        }

        // Upload each photo to Blob
        const uploadedUrls: string[] = [];

        for (let i = 0; i < photoUrls.length; i++) {
          const urlStr = photoUrls[i];
          if (!urlStr) continue;
          try {
            const url = await uploadPhotoToBlob(placeId, i + 1, urlStr);
            uploadedUrls.push(url);
          } catch (error) {
            console.error(`  Error uploading photo ${i + 1}: ${error}`);
          }
        }

        if (uploadedUrls.length === 0) {
          console.log(`  No photos uploaded for ${discovery.name || placeId}`);
          continue;
        }

        // Classify photos based on place type
        const rawPhotos = uploadedUrls.map(url => ({ url, source: 'google' }));
        const classifiedImages = classifyPhotos(rawPhotos, discovery.type);

        // Get required roles for this place type
        const requiredRoles = getRequiredRoles(discovery.type);

        // Select best photo for each required role
        const bestPhotos = selectBestPhotos(classifiedImages, requiredRoles);

        // Build PlaceImage array with role-classified photos
        const images: PlaceImage[] = [];

        // First add the required roles
        for (const role of requiredRoles) {
          const best = bestPhotos.get(role);
          if (best) {
            images.push({
              url: best.url,
              role: best.role,
              source: 'google-places',
            });
          }
        }

        // Then add any remaining photos as general
        const usedUrls = new Set(images.map(i => i.url));
        for (const classified of classifiedImages) {
          if (!usedUrls.has(classified.url)) {
            images.push({
              url: classified.url,
              role: 'general',
              source: 'google-places',
            });
            usedUrls.add(classified.url);
          }
        }

        // If no required roles met, use hero
        if (images.length === 0) {
          images.push({
            url: uploadedUrls[0]!,
            role: 'hero',
            source: 'google-places',
          });
        }

        if (!dryRun) {
          discovery.images = images;
          discovery.heroImage = images[0]?.url;
        }

        userUpdated++;
        totalUpdated++;

        console.log(
          `  ${discovery.name || discovery.id}: ${images.length} photo(s) enriched`
        );
      } catch (error) {
        console.error(`  Error enriching ${discovery.name || placeId}: ${error}`);
        continue;
      }
    }

    // Save updated discoveries to Blob
    if (userUpdated > 0 && !dryRun) {
      const discoveriesPayload: Discoveries = { discoveries };

      // Delete existing blob first, then write new one
      try {
        const { blobs } = await list({ prefix: `users/${user.id}/discoveries.json`, limit: 1, token });
        if (blobs[0]) await del(blobs[0].url, { token });
      } catch { /* ignore */ }
      await put(`users/${user.id}/discoveries.json`, JSON.stringify(discoveriesPayload, null, 2), {
        token,
        contentType: 'application/json',
        access: 'public',
        addRandomSuffix: false,
      });
    }

    console.log(
      `User ${user.id}: ${userUpdated}/${discoveries.filter(d => d.place_id && targetTypes.includes(d.type)).length} updated`
    );

    usersProcessed.push(user.id);
  }

  if (dryRun) {
    console.log(`\nDry run: ${totalUpdated} discoveries would be updated across ${usersProcessed.length} users`);
  } else {
    console.log(`\nEnrichment complete: ${totalUpdated} discoveries updated across ${usersProcessed.length} users`);
  }
}

enrich().catch(error => {
  console.error('Enrichment failed:', error);
  process.exit(1);
});