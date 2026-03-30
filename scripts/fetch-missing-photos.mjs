/**
 * fetch-missing-photos.mjs
 * Fetches hero photos from Google Places API for discoveries missing photos.
 * Uploads to Blob at place-photos/{placeId}/photos/1.jpg
 * Updates manifest.json and re-patches discoveries Blob.
 *
 * Usage: node scripts/fetch-missing-photos.mjs [--dry-run] [--limit N]
 */
import { list, put, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : Infinity;
const cardsDir = path.join(process.cwd(), 'data', 'placecards');

if (!GOOGLE_API_KEY) {
  console.error('NEXT_PUBLIC_GOOGLE_MAPS_KEY not set');
  process.exit(1);
}

// 1. Get list of place_ids that already have blob photos
console.log('Listing existing Blob photos...');
let allBlobs = [];
let cursor;
do {
  const result = await list({ prefix: 'place-photos', limit: 1000, cursor });
  allBlobs = allBlobs.concat(result.blobs);
  cursor = result.cursor;
} while (cursor);
const existingPathnames = new Set(allBlobs.map(b => b.pathname));
console.log(`Existing photo blobs: ${existingPathnames.size}`);

// 2. Load discoveries
console.log('Fetching discoveries...');
const { blobs } = await list({ prefix: 'users/john/discoveries' });
const blobUrl = blobs.find(b => b.pathname === 'users/john/discoveries.json')?.url || blobs[0].url;
const res = await fetch(blobUrl);
const raw = await res.json();
const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];

// Find discoveries with place_id but no actual blob photo
const missingPhoto = discoveries.filter(d => {
  if (!d.place_id) return false;
  const expectedPathname = `place-photos/${d.place_id}/photos/1.jpg`;
  return !existingPathnames.has(expectedPathname);
});

console.log(`Discoveries needing photos: ${missingPhoto.length}`);
if (DRY_RUN) {
  console.log('\n[DRY RUN] Would fetch photos for:');
  missingPhoto.forEach(d => console.log(`  ${d.name} [${d.place_id}]`));
  process.exit(0);
}

// 3. Fetch and upload photos
let fetched = 0, failed = 0;
const toProcess = missingPhoto.slice(0, LIMIT);
console.log(`\nFetching ${toProcess.length} photos...`);

function loadManifest(placeId) {
  const p = path.join(cardsDir, placeId, 'manifest.json');
  if (!fs.existsSync(p)) return { place_id: placeId, images: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { place_id: placeId, images: [] }; }
}

function saveManifest(placeId, manifest) {
  const dir = path.join(cardsDir, placeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

for (const d of toProcess) {
  const placeId = d.place_id;
  const photoPathname = `place-photos/${placeId}/photos/1.jpg`;

  try {
    // Get place details to find photo reference
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,photos&key=${GOOGLE_API_KEY}`;
    const detailsRes = await fetch(detailsUrl);
    const details = await detailsRes.json();

    if (details.status !== 'OK' || !details.result?.photos?.length) {
      console.log(`  ✗ ${d.name} — no photos in Places API (status: ${details.status})`);
      failed++;
      continue;
    }

    const photoRef = details.result.photos[0].photo_reference;

    // Fetch the actual photo
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photoreference=${photoRef}&key=${GOOGLE_API_KEY}`;
    const photoRes = await fetch(photoUrl);

    if (!photoRes.ok) {
      console.log(`  ✗ ${d.name} — photo fetch failed (${photoRes.status})`);
      failed++;
      continue;
    }

    const photoBuffer = await photoRes.arrayBuffer();
    const photoBlob = new Blob([photoBuffer], { type: 'image/jpeg' });

    // Upload to Blob
    const uploaded = await put(photoPathname, photoBlob, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
      allowOverwrite: true,
    });

    // Update discovery heroImage
    d.heroImage = uploaded.url;

    // Update manifest
    const manifest = loadManifest(placeId);
    const existing = manifest.images.find(i => i.id === 'photo-1');
    if (!existing) {
      manifest.images.push({
        id: 'photo-1',
        path: uploaded.url,
        category: 'exterior',
        caption: '',
        order: 1,
        classified: false,
        source: 'google-places',
      });
    } else {
      existing.path = uploaded.url;
    }
    saveManifest(placeId, manifest);

    fetched++;
    console.log(`  ✓ ${d.name} → ${uploaded.url}`);

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 200));

  } catch (err) {
    console.log(`  ✗ ${d.name} — error: ${err.message}`);
    failed++;
  }
}

console.log(`\nFetched: ${fetched}, Failed: ${failed}`);

// 4. Re-patch all heroImages in discoveries from manifests
console.log('\nRe-patching all heroImages from updated manifests...');
let patched = 0;
for (const d of discoveries) {
  if (!d.place_id) continue;
  const manifestPath = path.join(cardsDir, d.place_id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const images = manifest.images || [];
    if (images.length > 0) {
      const sorted = [...images].sort((a, b) => (a.order || 99) - (b.order || 99));
      if (d.heroImage !== sorted[0].path) {
        d.heroImage = sorted[0].path;
        patched++;
      }
    }
  } catch {}
}
console.log(`Re-patched ${patched} heroImages from manifests`);

// 5. Count final coverage
const withHero = discoveries.filter(d => d.heroImage && !d.heroImage.includes('/photos/1.jpg') || (d.heroImage && existingPathnames.has(`place-photos/${d.place_id}/photos/1.jpg`))).length;
const withAnyHero = discoveries.filter(d => d.heroImage).length;
console.log(`\nFinal heroImage count: ${withAnyHero}/${discoveries.length}`);

// 6. Update Blob
console.log('Updating discoveries Blob...');
for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(discoveries), {
  access: 'public',
  addRandomSuffix: false,
});
console.log('✓ Done. Run check-blob-photos.mjs to verify.');
