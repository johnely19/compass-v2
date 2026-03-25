#!/usr/bin/env node
/* ============================================================
   #76 — Migrate V1 place card photos to V2 Blob + manifests.
   Source: /vercel-briefing-app/public/placecards/{pid}/*.jpg
   Target: Blob at place-photos/{pid}/{filename}
   Updates: data/placecards/{pid}/manifest.json
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { put, list } from '@vercel/blob';

const V1_PHOTOS = '/Users/john/.openclaw/workspace/vercel-briefing-app/public/placecards';
const V2_CARDS = join(process.cwd(), 'data', 'placecards');
const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;

// Category inference from filename
function inferCategory(filename) {
  const name = filename.toLowerCase();
  if (name.startsWith('food')) return 'food';
  if (name.startsWith('drink') || name.startsWith('cocktail') || name.startsWith('bar')) return 'drinks';
  if (name.startsWith('interior') || name.startsWith('inside')) return 'interior';
  if (name.startsWith('exterior') || name.startsWith('outside') || name.startsWith('front')) return 'exterior';
  if (name.startsWith('map')) return 'map';
  if (name.startsWith('menu')) return 'menu';
  return 'general';
}

function loadManifest(placeId) {
  const p = join(V2_CARDS, placeId, 'manifest.json');
  if (!existsSync(p)) return { place_id: placeId, images: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { place_id: placeId, images: [] }; }
}

function saveManifest(placeId, manifest) {
  const p = join(V2_CARDS, placeId, 'manifest.json');
  writeFileSync(p, JSON.stringify(manifest, null, 2));
}

async function uploadPhoto(placeId, filename, filePath) {
  const blobPath = `place-photos/${placeId}/${filename}`;

  // Check if already uploaded
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    if (blobs[0]) return blobs[0].url; // already exists
  } catch { /* continue */ }

  const buffer = readFileSync(filePath);
  const ext = extname(filename).slice(1).toLowerCase();
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const blob = await put(blobPath, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
  });

  return blob.url;
}

async function main() {
  console.log(`\n📸 V1 Photo Migration — #76`);
  if (DRY_RUN) console.log('   DRY RUN\n');
  if (!BLOB_BASE) console.warn('   Warning: NEXT_PUBLIC_BLOB_BASE_URL not set\n');

  // Collect all V1 cards with photos
  const targets = [];
  for (const placeId of readdirSync(V1_PHOTOS)) {
    const dir = join(V1_PHOTOS, placeId);
    if (!statSync(dir).isDirectory()) continue;

    const photos = readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && f !== 'map.png')
      .sort((a, b) => {
        // Order: exterior first, then interior, then food/drinks, then others
        const order = { exterior: 0, interior: 1, food: 2, drinks: 3, general: 4 };
        return (order[inferCategory(a)] ?? 5) - (order[inferCategory(b)] ?? 5);
      });

    if (photos.length === 0) continue;

    // Check if V2 manifest already has real photos (blob or place-photos)
    const manifest = loadManifest(placeId);
    const hasRealPhotos = (manifest.images || []).some(img =>
      img.path?.includes('/place-photos/') || img.path?.includes('blob')
    );
    if (hasRealPhotos) continue; // already migrated

    // Only process if V2 has a card entry
    if (!existsSync(join(V2_CARDS, placeId))) continue;

    targets.push({ placeId, photos, dir, manifest });
  }

  console.log(`  Found ${targets.length} cards to migrate\n`);

  let updated = 0;
  let totalPhotos = 0;
  let count = 0;

  for (const { placeId, photos, dir, manifest } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${placeId.slice(0, 20)} (${photos.length} photos) `);

    if (DRY_RUN) { console.log('— skipped (dry run)'); continue; }

    const newImages = [];
    let failed = 0;

    for (const filename of photos) {
      const filePath = join(dir, filename);
      try {
        const url = await uploadPhoto(placeId, filename, filePath);
        const category = inferCategory(filename);
        newImages.push({
          id: filename.replace(/\.[^.]+$/, ''),
          path: url.replace(BLOB_BASE, '') || url, // store relative if possible
          category,
          caption: '',
          order: newImages.length + 1,
        });
      } catch (err) {
        console.error(`\n    ❌ ${filename}: ${err.message}`);
        failed++;
      }
    }

    if (newImages.length > 0) {
      // Prepend new photos to existing manifest images
      manifest.images = [...newImages, ...(manifest.images || []).filter(img =>
        !newImages.find(n => n.id === img.id)
      )];
      saveManifest(placeId, manifest);
      console.log(`✅ ${newImages.length}/${photos.length} photos${failed > 0 ? ` (${failed} failed)` : ''}`);
      updated++;
      totalPhotos += newImages.length;
    } else {
      console.log(`❌ all failed`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Cards updated: ${updated} | Photos uploaded: ${totalPhotos}\n`);
}

main().catch(console.error);
