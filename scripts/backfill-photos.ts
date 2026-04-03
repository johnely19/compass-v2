import { list, put, del, head } from '@vercel/blob';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// Load env vars from .env.local
config({ path: join(process.cwd(), '.env.local') });

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

interface PlaceImage {
  url: string;
  role: 'hero' | 'general';
  source: 'google' | 'user';
  createdAt?: string;
}

interface Discovery {
  id: string;
  place_id?: string;
  heroImage?: string;
  images?: PlaceImage[];
  name?: string;
  description?: string;
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

// Rate limiting
let lastGoogleCall = 0;
let lastPhotoDownload = 0;

async function rateLimitedGoogleCall<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const elapsed = now - lastGoogleCall;
  if (elapsed < 200) {
    await new Promise(r => setTimeout(r, 200 - elapsed));
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

// Check if cached photo exists in Blob
async function checkCachedPhotos(placeId: string): Promise<string[] | null> {
  try {
    const result = await list({
      prefix: `place-photos/${placeId}/`,
      token,
    });

    if (result.blobs.length === 0) {
      return null;
    }

    // Sort by number to ensure correct order
    const sorted = result.blobs
      .filter(b => b.pathname.match(/\/\d+\.jpg$/))
      .sort((a, b) => {
        const numA = parseInt(a.pathname.split('/').pop()!.replace('.jpg', ''), 10);
        const numB = parseInt(b.pathname.split('/').pop()!.replace('.jpg', ''), 10);
        return numA - numB;
      });

    return sorted.map(b => b.url);
  } catch (error) {
    return null;
  }
}

// Fetch place details from Google Places API
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

  // Take up to 6 photos
  const photoRefs = data.photos.slice(0, 6).map(p => p.name);

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

// Upload photo to Blob and return the URL
async function uploadPhotoToBlob(
  placeId: string,
  n: number,
  photoUrl: string
): Promise<string> {
  // Fetch the photo
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

// Main backfill function
async function backfill() {
  // Read users.json
  const usersFile = readFileSync(join(process.cwd(), 'data/users.json'), 'utf-8');
  const usersData: Users = JSON.parse(usersFile);

  const users = Object.values(usersData.users).filter(u => u.active !== false);

  let totalUpdated = 0;
  const usersProcessed: string[] = [];

  for (const user of users) {
    // If --user flag specified, skip other users
    if (singleUser && user.id !== singleUser) {
      continue;
    }

    console.log(`User ${user.id}: processing...`);

    // Fetch user's discoveries from Blob
    const discoveriesUrl = `users/${user.id}/discoveries.json`;

    let discoveries: Discovery[] = [];

    try {
      const response = await fetch(discoveriesUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = (await response.json()) as Discoveries;
        discoveries = data.discoveries || [];
      } else if (response.status === 404) {
        console.log(`  User ${user.id}: no discoveries found`);
        continue;
      } else {
        console.error(`  Error fetching discoveries: ${response.status}`);
        continue;
      }
    } catch (error) {
      console.error(`  Error fetching discoveries: ${error}`);
      continue;
    }

    let userUpdated = 0;

    // Process each discovery with a place_id but missing photos
    for (const discovery of discoveries) {
      if (!discovery.place_id) {
        continue;
      }

      // Check if already has photos
      if (discovery.heroImage && discovery.images && discovery.images.length > 0) {
        continue;
      }

      const placeId = discovery.place_id;

      // Check Blob for cached photos first
      let photoUrls: string[] | null = await checkCachedPhotos(placeId);

      if (!photoUrls || photoUrls.length === 0) {
        // Fetch from Google Places API
        console.log(`  Fetching photos for place ${placeId}...`);

        try {
          photoUrls = await fetchGooglePlacePhotos(placeId);

          if (photoUrls.length === 0) {
            console.log(`  No photos available for place ${placeId}`);
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

          photoUrls = uploadedUrls;

          if (photoUrls.length === 0) {
            console.log(`  No photos uploaded for place ${placeId}`);
            continue;
          }
        } catch (error) {
          console.error(`  Error fetching Google photos: ${error}`);
          continue;
        }
      }

      // Build PlaceImage array
      const images: PlaceImage[] = photoUrls.map((url, i) => ({
        url,
        role: i === 0 ? 'hero' : 'general',
        source: 'google' as const,
        createdAt: new Date().toISOString(),
      }));

      // Update discovery
      const firstImage = images[0];
      if (!firstImage) {
        console.log(`  No images to add for ${discovery.name || discovery.id}`);
        continue;
      }
      const heroImage = firstImage.url;

      if (!dryRun) {
        discovery.heroImage = heroImage;
        discovery.images = images;
      }

      userUpdated++;
      totalUpdated++;

      console.log(
        `  ${discovery.name || discovery.id}: ${photoUrls.length} photo(s) added`
      );
    }

    // Save updated discoveries to Blob
    if (userUpdated > 0 && !dryRun) {
      const discoveriesPayload: Discoveries = { discoveries };

      await put(`users/${user.id}/discoveries.json`, JSON.stringify(discoveriesPayload, null, 2), {
        token,
        contentType: 'application/json',
        access: 'public',
      });
    }

    console.log(
      `User ${user.id}: ${userUpdated}/${discoveries.filter(d => d.place_id).length} updated`
    );

    usersProcessed.push(user.id);
  }

  if (dryRun) {
    console.log(`\nDry run: ${totalUpdated} discoveries would be updated across ${usersProcessed.length} users`);
  } else {
    console.log(`\nBackfill complete: ${totalUpdated} discoveries updated across ${usersProcessed.length} users`);
  }
}

backfill().catch(error => {
  console.error('Backfill failed:', error);
  process.exit(1);
});