/**
 * fix-hero-images.mjs
 * Sets heroImage only for discoveries where we have a confirmed photo in Blob.
 * Clears heroImages that point to non-existent convention URLs.
 * Also patches from manifest.json for any place_id with real photos.
 */
import { list, put, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';
const cardsDir = path.join(process.cwd(), 'data', 'placecards');

// 1. Load full blob photo index
console.log('Loading blob photo index...');
const idxFile = path.join(process.cwd(), 'scripts/blob-photo-index.json');
if (!fs.existsSync(idxFile)) {
  console.error('Run list-all-blob-photos.mjs first to build the index.');
  process.exit(1);
}
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
const blobPathSet = new Set(idx.pathnames);
console.log(`Blob index: ${idx.pathnames.length} photos, ${idx.placeIds.length} unique places`);

// 2. Build photo URL map: placeId -> best verified URL
// Priority: manifest.json (has classified/ordered photos) > blob index
const photoUrlMap = new Map();

// From manifests (already verified blob URLs)
const cardDirs = fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter(d => !d.startsWith('.')) : [];
for (const placeId of cardDirs) {
  const manifestPath = path.join(cardsDir, placeId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const images = (manifest.images || []).sort((a, b) => (a.order || 99) - (b.order || 99));
    if (images.length > 0) {
      const url = images[0].path;
      // Only use if it's a real blob URL
      if (url && url.includes(BASE_URL)) {
        const pathname = url.replace(BASE_URL + '/', '');
        if (blobPathSet.has(pathname)) {
          photoUrlMap.set(placeId, url);
        }
      }
    }
  } catch {}
}
console.log(`Verified from manifests: ${photoUrlMap.size} places`);

// From blob index (for places that have photos but no manifest entry)
for (const placeId of idx.placeIds) {
  if (photoUrlMap.has(placeId)) continue;
  // Find first photo for this place_id
  const firstPhoto = idx.pathnames.find(p => p.startsWith(`place-photos/${placeId}/`));
  if (firstPhoto) {
    photoUrlMap.set(placeId, `${BASE_URL}/${firstPhoto}`);
  }
}
console.log(`Total verified photo URLs: ${photoUrlMap.size} places`);

// 3. Load discoveries
console.log('\nFetching discoveries...');
const { blobs } = await list({ prefix: 'users/john/discoveries' });
const blobUrl = blobs.find(b => b.pathname === 'users/john/discoveries.json')?.url || blobs[0].url;
const res = await fetch(blobUrl);
const raw = await res.json();
const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];
console.log(`Total discoveries: ${discoveries.length}`);

// 4. Patch heroImages — only verified URLs
let set = 0, cleared = 0, unchanged = 0;
for (const d of discoveries) {
  const pid = d.place_id;
  if (!pid) {
    // No place_id — clear any existing heroImage (it's invalid)
    if (d.heroImage) { delete d.heroImage; cleared++; }
    continue;
  }

  const verifiedUrl = photoUrlMap.get(pid);
  if (verifiedUrl) {
    if (d.heroImage !== verifiedUrl) {
      d.heroImage = verifiedUrl;
      set++;
    } else {
      unchanged++;
    }
  } else {
    // No verified photo for this place_id — clear heroImage
    if (d.heroImage) { delete d.heroImage; cleared++; }
  }
}

const withHero = discoveries.filter(d => d.heroImage).length;
console.log(`\nSet: ${set}, Cleared: ${cleared}, Unchanged: ${unchanged}`);
console.log(`Final coverage: ${withHero}/${discoveries.length} (${Math.round(withHero/discoveries.length*100)}%)`);

// Show which have photos
console.log('\n✓ Discoveries WITH verified photos:');
discoveries.filter(d => d.heroImage).forEach(d => console.log(`  ${d.name}`));

console.log('\n✗ Discoveries WITHOUT photos (will show gradient):');
discoveries.filter(d => !d.heroImage).forEach(d => console.log(`  ${d.name} [${d.place_id || 'no place_id'}]`));

// 5. Save
console.log('\nSaving to Blob...');
for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(discoveries), {
  access: 'public',
  addRandomSuffix: false,
});
console.log('✓ Done.');
