/**
 * list-all-blob-photos.mjs
 * Paginates through all Blob photos, builds a complete set of place_ids with photos.
 */
import { list } from '@vercel/blob';

const allBlobs = [];
let cursor;

do {
  const result = await list({ prefix: 'place-photos', limit: 1000, cursor });
  allBlobs.push(...result.blobs);
  cursor = result.cursor;
  process.stdout.write(`\rFetched: ${allBlobs.length} blobs...`);
} while (cursor);

console.log(`\nTotal photo blobs: ${allBlobs.length}`);

const pids = new Set(allBlobs.map(b => b.pathname.split('/')[1]));
console.log(`Unique place_ids: ${pids.size}`);

// Write to a file for use by other scripts
import { writeFileSync } from 'fs';
const data = {
  updatedAt: new Date().toISOString(),
  placeIds: [...pids],
  pathnames: allBlobs.map(b => b.pathname),
};
writeFileSync('scripts/blob-photo-index.json', JSON.stringify(data, null, 2));
console.log('Saved to scripts/blob-photo-index.json');
