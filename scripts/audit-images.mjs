/**
 * audit-images.mjs
 * Audits heroImage coverage for john's discoveries Blob.
 * Reports: total, with heroImage, without, place_id available but no heroImage.
 * Usage: node scripts/audit-images.mjs [--fix]
 */
import { list, put, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const FIX = process.argv.includes('--fix');
const cardsDir = path.join(process.cwd(), 'data', 'placecards');
const BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

// 1. Build photo index from manifest.json files (primary source of truth)
console.log('Building photo index from manifests...');
const photoIndex = new Map(); // placeId -> best heroImage url
const nameToPlaceId = new Map(); // normalized name -> placeId

const cardDirs = fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter(d => !d.startsWith('.')) : [];

for (const placeId of cardDirs) {
  const manifestPath = path.join(cardsDir, placeId, 'manifest.json');
  const cardPath = path.join(cardsDir, placeId, 'card.json');

  // Get photo from manifest
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const images = manifest.images || [];
      if (images.length > 0) {
        // Use first image (ordered by .order field if possible)
        const sorted = [...images].sort((a, b) => (a.order || 99) - (b.order || 99));
        photoIndex.set(placeId, sorted[0].path);
      }
    } catch {}
  }

  // If no manifest photo, try Blob convention URL
  if (!photoIndex.has(placeId)) {
    photoIndex.set(placeId, `${BASE_URL}/place-photos/${placeId}/photos/1.jpg`);
  }

  // Build name index from card.json
  if (fs.existsSync(cardPath)) {
    try {
      const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
      const name = (card.identity?.name || card.name || '').toLowerCase().trim();
      if (name) nameToPlaceId.set(name, placeId);
    } catch {}
  }
}

console.log(`Photo index: ${photoIndex.size} places | Name index: ${nameToPlaceId.size} places`);

// 2. Load discoveries from Blob
console.log('\nFetching discoveries from Blob...');
const { blobs } = await list({ prefix: 'users/john/discoveries' });
if (blobs.length === 0) { console.error('No discoveries blob found!'); process.exit(1); }

const blobUrl = blobs.find(b => b.pathname === 'users/john/discoveries.json')?.url || blobs[0].url;
const res = await fetch(blobUrl);
const raw = await res.json();
const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];

// 3. Audit
const withHeroImage = discoveries.filter(d => d.heroImage);
const missingHero = discoveries.filter(d => !d.heroImage);
const missingHeroButHasPlaceId = missingHero.filter(d => d.place_id);
const canFix = missingHero.filter(d => d.place_id && photoIndex.has(d.place_id));

console.log('\n=== IMAGE AUDIT ===');
console.log(`Total discoveries: ${discoveries.length}`);
console.log(`With heroImage: ${withHeroImage.length}/${discoveries.length} (${Math.round(withHeroImage.length/discoveries.length*100)}%)`);
console.log(`Missing heroImage: ${missingHero.length}`);
console.log(`  Has place_id but no heroImage: ${missingHeroButHasPlaceId.length}`);
console.log(`  Can fix from photo index: ${canFix.length}`);

if (!FIX) {
  console.log('\nRun with --fix to patch heroImages and update Blob.');
  process.exit(0);
}

// 4. Fix
console.log('\n=== FIX MODE ===');
let fixed = 0, fromManifest = 0, fromConvention = 0, byName = 0, stillMissing = 0;

for (const d of discoveries) {
  if (d.heroImage) continue;

  // Try place_id → manifest photo index
  if (d.place_id && photoIndex.has(d.place_id)) {
    const url = photoIndex.get(d.place_id);
    d.heroImage = url;
    fixed++;
    if (url.includes(BASE_URL)) fromManifest++;
    else fromConvention++;
    continue;
  }

  // Try name match → place_id → photo
  const nameKey = (d.name || '').toLowerCase().trim();
  const matchedId = nameToPlaceId.get(nameKey);
  if (matchedId) {
    if (!d.place_id) {
      d.place_id = matchedId;
      d.placeIdStatus = 'verified-by-name';
    }
    if (photoIndex.has(matchedId)) {
      d.heroImage = photoIndex.get(matchedId);
      fixed++;
      byName++;
      continue;
    }
  }

  // Last resort: build convention URL from place_id
  if (d.place_id) {
    d.heroImage = `${BASE_URL}/place-photos/${d.place_id}/photos/1.jpg`;
    fixed++;
    fromConvention++;
    continue;
  }

  stillMissing++;
}

const totalWithHero = discoveries.filter(d => d.heroImage).length;
console.log(`Fixed: ${fixed} (${fromManifest} from manifests, ${byName} by name, ${fromConvention} convention URLs)`);
console.log(`Still missing: ${stillMissing} (no place_id, no name match)`);
console.log(`\nFinal coverage: ${totalWithHero}/${discoveries.length} (${Math.round(totalWithHero/discoveries.length*100)}%)`);

if (stillMissing > 0) {
  const unfixable = discoveries.filter(d => !d.heroImage);
  console.log('\nUnfixable (no place_id):');
  unfixable.forEach(d => console.log(`  ✗ ${d.name} [id: ${d.id}]`));
}

console.log('\nSaving updated discoveries to Blob...');
for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(discoveries), {
  access: 'public',
  addRandomSuffix: false,
});
console.log('✓ Blob updated.');
