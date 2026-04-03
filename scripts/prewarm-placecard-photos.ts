/**
 * Pre-warm photos for all place cards in the index.
 * Fetches photos from Google Places API and caches them in Vercel Blob.
 * 
 * Usage:
 *   npx tsx scripts/prewarm-placecard-photos.ts [--dry-run] [--limit N] [--skip-cached]
 */

import { list, put, head } from '@vercel/blob';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(process.cwd(), '.env.local') });

const token = process.env.BLOB_READ_WRITE_TOKEN;
const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

if (!token) { console.error('BLOB_READ_WRITE_TOKEN not set'); process.exit(1); }
if (!googleApiKey) { console.error('GOOGLE_PLACES_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipCached = args.includes('--skip-cached');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0') : Infinity;

interface IndexEntry { name: string; type: string; }

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function isPhotoCached(placeId: string): Promise<string | null> {
  try {
    const result = await list({ prefix: `place-photos/${placeId}/`, limit: 1, token });
    return result.blobs[0]?.url ?? null;
  } catch { return null; }
}

async function fetchAndCachePhoto(placeId: string): Promise<{ url: string; source: string } | null> {
  // Try Google Places
  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos,location`,
      { headers: { 'X-Goog-Api-Key': googleApiKey!, 'Content-Type': 'application/json' } }
    );

    if (!detailsRes.ok) {
      const body = await detailsRes.text();
      if (body.includes('no longer valid')) return null; // stale place ID
      return null;
    }

    const details = await detailsRes.json();
    const photos = details.photos;
    const location = details.location;

    if (photos?.length > 0) {
      const photoName = photos[0].name;
      const photoRes = await fetch(
        `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${googleApiKey}`
      );
      if (photoRes.ok) {
        const buffer = await photoRes.arrayBuffer();
        const uploaded = await put(`place-photos/${placeId}/1.jpg`, new Blob([buffer], { type: 'image/jpeg' }), {
          access: 'public', addRandomSuffix: false, contentType: 'image/jpeg', token,
        });
        return { url: uploaded.url, source: 'google-places' };
      }
    }

    // Fallback: Street View
    if (location) {
      const { latitude: lat, longitude: lng } = location;
      const svRes = await fetch(
        `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${lat},${lng}&key=${googleApiKey}`
      );
      if (svRes.ok && svRes.headers.get('content-type')?.includes('image')) {
        const buffer = await svRes.arrayBuffer();
        const uploaded = await put(`place-photos/${placeId}/1.jpg`, new Blob([buffer], { type: 'image/jpeg' }), {
          access: 'public', addRandomSuffix: false, contentType: 'image/jpeg', token,
        });
        return { url: uploaded.url, source: 'street-view' };
      }

      // Fallback: Static Map
      const mapRes = await fetch(
        `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=800x600&maptype=roadmap&markers=color:red|${lat},${lng}&key=${googleApiKey}`
      );
      if (mapRes.ok && mapRes.headers.get('content-type')?.includes('image')) {
        const buffer = await mapRes.arrayBuffer();
        const uploaded = await put(`place-photos/${placeId}/1.jpg`, new Blob([buffer], { type: 'image/jpeg' }), {
          access: 'public', addRandomSuffix: false, contentType: 'image/jpeg', token,
        });
        return { url: uploaded.url, source: 'static-map' };
      }
    }
  } catch (e) {
    console.error(`  Error: ${(e as Error).message}`);
  }
  return null;
}

async function main() {
  const indexPath = join(process.cwd(), 'data', 'placecards', 'index.json');
  const index: Record<string, IndexEntry> = JSON.parse(readFileSync(indexPath, 'utf8'));
  const placeIds = Object.keys(index);

  console.log(`Total place cards: ${placeIds.length}`);
  if (dryRun) console.log('DRY RUN — no writes');
  if (limit < Infinity) console.log(`Limit: ${limit}`);

  let cached = 0;
  let fetched = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const placeId of placeIds) {
    if (processed >= limit) break;
    processed++;

    const name = index[placeId]?.name ?? placeId;
    
    // Check cache first
    const cachedUrl = await isPhotoCached(placeId);
    if (cachedUrl) {
      cached++;
      if (!skipCached) {
        // Still count but don't log every cached one
      }
      continue;
    }

    // Need to fetch
    console.log(`[${processed}/${Math.min(placeIds.length, limit)}] ${name} (${placeId.substring(0, 20)}...)`);

    if (dryRun) {
      fetched++;
      continue;
    }

    await sleep(250); // rate limit

    const result = await fetchAndCachePhoto(placeId);
    if (result) {
      fetched++;
      console.log(`  ✅ ${result.source}`);
    } else {
      failed++;
      console.log(`  ❌ no photo available`);
    }
  }

  console.log(`\nDone!`);
  console.log(`  Already cached: ${cached}`);
  console.log(`  Newly fetched:  ${fetched}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Total:          ${processed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
