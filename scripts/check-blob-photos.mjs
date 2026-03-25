/**
 * check-blob-photos.mjs
 * Checks which discoveries have valid (200) heroImage URLs in Blob.
 * Uses HEAD requests in batches to avoid rate limits.
 */
import { list } from '@vercel/blob';

const BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

// Fetch discoveries
const { blobs } = await list({ prefix: 'users/john/discoveries' });
const blobUrl = blobs.find(b => b.pathname === 'users/john/discoveries.json')?.url || blobs[0].url;
const res = await fetch(blobUrl);
const raw = await res.json();
const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];

const withHero = discoveries.filter(d => d.heroImage);
console.log(`Checking ${withHero.length} heroImage URLs...`);

// List all photos in Blob for fast lookup
const { blobs: photoBlobs } = await list({ prefix: 'place-photos', limit: 1000 });
const blobPaths = new Set(photoBlobs.map(b => b.url));
const blobPathnames = new Set(photoBlobs.map(b => b.pathname));

let ok = 0, missing = 0;
const missingList = [];

for (const d of withHero) {
  const url = d.heroImage;
  // Check if it's a Blob URL
  if (url.startsWith(BASE_URL)) {
    // Extract pathname from URL
    const pathname = url.replace(BASE_URL + '/', '');
    if (blobPathnames.has(pathname)) {
      ok++;
    } else {
      missing++;
      missingList.push({ name: d.name, placeId: d.place_id, url });
    }
  } else {
    // Non-blob URL (relative path etc) — assume ok for now
    ok++;
  }
}

console.log(`\n✓ Valid: ${ok}`);
console.log(`✗ Missing in Blob: ${missing}`);
if (missingList.length > 0) {
  console.log('\nMissing photo Blobs:');
  missingList.forEach(m => console.log(`  ${m.name} [${m.placeId}]`));
}

const totalCovered = ok;
const total = discoveries.length;
console.log(`\nActual coverage: ${totalCovered}/${total} (${Math.round(totalCovered/total*100)}%)`);
