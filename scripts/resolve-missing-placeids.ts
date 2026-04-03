/**
 * Find real Google Place IDs for place cards with synthetic/invalid IDs.
 * Uses Google Places Text Search to resolve by name + city.
 *
 * Usage:
 *   npx tsx scripts/resolve-missing-placeids.ts [--dry-run] [--limit N] [--apply]
 */

import { list, put, head } from '@vercel/blob';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(process.cwd(), '.env.local') });

const token = process.env.BLOB_READ_WRITE_TOKEN;
const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

if (!token) { console.error('BLOB_READ_WRITE_TOKEN not set'); process.exit(1); }
if (!googleApiKey) { console.error('GOOGLE_PLACES_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0') : Infinity;

interface IndexEntry { name: string; type: string; }

function isRealPlaceId(id: string): boolean {
  // Real Google Place IDs start with ChIJ and are ~27 chars of base64-like chars
  if (!id.startsWith('ChIJ')) return false;
  // Check it's not a hand-crafted one
  if (id.includes('Restaurant') || id.includes('Toronto') || id.includes('Bushwick') ||
      id.includes('LES') || id.includes('Wburg') || id.includes('Carroll') ||
      id.includes('Greenp') || id.includes('RedHook') || id.includes('WV') ||
      id.includes('Jazz') || id.includes('2026') || id.includes('2025')) return false;
  return true;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function isPhotoCached(placeId: string): Promise<boolean> {
  try {
    const result = await list({ prefix: `place-photos/${placeId}/`, limit: 1, token });
    return result.blobs.length > 0;
  } catch { return false; }
}

async function searchPlace(name: string, city?: string): Promise<{ placeId: string; formattedAddress: string } | null> {
  const query = city ? `${name} ${city}` : name;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey!,
        'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.displayName',
      },
      body: JSON.stringify({ textQuery: query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    return { placeId: place.id, formattedAddress: place.formattedAddress };
  } catch {
    return null;
  }
}

async function fetchAndCachePhoto(placeId: string): Promise<boolean> {
  try {
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos`,
      { headers: { 'X-Goog-Api-Key': googleApiKey!, 'Content-Type': 'application/json' } }
    );
    if (!detailsRes.ok) return false;
    const details = await detailsRes.json();
    const photos = details.photos;
    if (!photos?.length) return false;

    const photoRes = await fetch(
      `https://places.googleapis.com/v1/${photos[0].name}/media?maxWidthPx=800&key=${googleApiKey}`
    );
    if (!photoRes.ok) return false;

    const buffer = await photoRes.arrayBuffer();
    await put(`place-photos/${placeId}/1.jpg`, new Blob([buffer], { type: 'image/jpeg' }), {
      access: 'public', addRandomSuffix: false, contentType: 'image/jpeg', token,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const indexPath = join(process.cwd(), 'data', 'placecards', 'index.json');
  const index: Record<string, IndexEntry> = JSON.parse(readFileSync(indexPath, 'utf8'));

  // Find entries with bad place IDs (no cached photo AND not a real place ID)
  const needsResolution: Array<{ oldId: string; name: string; type: string }> = [];

  for (const [placeId, entry] of Object.entries(index)) {
    const cached = await isPhotoCached(placeId);
    if (cached) continue;
    
    if (!isRealPlaceId(placeId)) {
      needsResolution.push({ oldId: placeId, name: entry.name, type: entry.type });
    }
  }

  console.log(`Found ${needsResolution.length} place cards with invalid/synthetic IDs needing resolution`);
  if (dryRun) console.log('DRY RUN — no writes\n');

  const remapping: Record<string, string> = {};
  let resolved = 0;
  let failed = 0;
  let processed = 0;

  for (const entry of needsResolution) {
    if (processed >= limit) break;
    processed++;

    console.log(`[${processed}/${Math.min(needsResolution.length, limit)}] ${entry.name} (${entry.oldId.substring(0, 30)}...)`);

    if (dryRun) { continue; }

    await sleep(300);

    // Try to resolve with city context
    const city = entry.name.includes('Toronto') || entry.type === 'development' ? 'Toronto' : undefined;
    const result = await searchPlace(entry.name, city);

    if (result) {
      console.log(`  ✅ Resolved → ${result.placeId} (${result.formattedAddress})`);
      remapping[entry.oldId] = result.placeId;
      resolved++;

      // Fetch photo for the new place ID
      await sleep(200);
      const photoOk = await fetchAndCachePhoto(result.placeId);
      if (photoOk) {
        console.log(`  📸 Photo cached`);
      } else {
        console.log(`  ⚠️ No photo available for new ID`);
      }
    } else {
      console.log(`  ❌ Could not resolve`);
      failed++;
    }
  }

  console.log(`\nDone!`);
  console.log(`  Resolved:  ${resolved}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Total:     ${processed}`);

  if (Object.keys(remapping).length > 0) {
    console.log(`\nRemapping:`);
    for (const [old, newId] of Object.entries(remapping)) {
      console.log(`  ${old} → ${newId}`);
    }

    if (apply) {
      console.log('\nApplying remapping to index.json...');
      const newIndex: Record<string, IndexEntry> = {};
      for (const [id, entry] of Object.entries(index)) {
        const newId = remapping[id] || id;
        newIndex[newId] = entry;
      }
      writeFileSync(indexPath, JSON.stringify(newIndex, null, 2));
      console.log('Index updated!');
    } else {
      console.log('\nUse --apply to update index.json with new place IDs');
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
