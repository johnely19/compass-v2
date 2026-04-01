#!/usr/bin/env node
/**
 * Enrich accommodation placecards with Google Places photos.
 * 
 * For each accommodation card in data/placecards/ that:
 *   - Has type: "accommodation"  
 *   - Has a Google Place ID (starts with ChIJ)
 *   - Has no manifest.json or manifest with 0 images
 * 
 * Fetches up to 5 photos from Google Places and saves URLs to manifest.json
 * so adaptCard() can pick them up automatically.
 * 
 * Usage: node scripts/enrich-accommodation-photos.mjs [--dry-run] [--force] [--limit N]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CARDS_DIR = join(ROOT, 'data', 'placecards');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX >= 0 ? parseInt(process.argv[LIMIT_IDX + 1]) : Infinity;
const MAX_PHOTOS = 5;
const RATE_LIMIT_MS = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCard(placeId) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function loadManifest(placeId) {
  const p = join(CARDS_DIR, placeId, 'manifest.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function saveManifest(placeId, manifest) {
  const dir = join(CARDS_DIR, placeId);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'manifest.json');
  writeFileSync(p, JSON.stringify(manifest, null, 2));
}

/**
 * Fetch photo names from Google Places using goplaces CLI.
 * Returns array of photo name strings.
 */
function fetchPhotoNames(placeId) {
  try {
    const result = execSync(`goplaces details ${placeId} --photos --json`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const data = JSON.parse(result);
    return (data.photos || []).map(p => p.name).filter(Boolean);
  } catch (e) {
    console.error(`  ❌ Failed to fetch photos for ${placeId}: ${e.message?.slice(0, 100)}`);
    return [];
  }
}

/**
 * Fetch the actual photo URL from a photo name.
 */
function fetchPhotoUrl(photoName) {
  try {
    const result = execSync(`goplaces photo "${photoName}" --max-width 1200`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const match = result.match(/URL:\s*(https?:\/\/\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function processCard(placeId) {
  // Check existing manifest
  const manifest = loadManifest(placeId);
  if (!FORCE && manifest?.images && manifest.images.length > 0) {
    console.log(`  ⏭  ${placeId}: already has ${manifest.images.length} images, skipping`);
    return false;
  }

  // For non-ChIJ IDs (like boston-omni-parker), look up Google Place ID
  let googlePlaceId = placeId;
  if (!placeId.startsWith('ChIJ')) {
    const card = loadCard(placeId);
    const name = card?.identity?.name;
    const city = card?.identity?.city;
    console.log(`  🔍 Looking up Google Place ID for "${name}" in ${city}...`);
    const foundId = lookupPlaceId(name, city);
    if (!foundId) {
      console.log(`  ⚠️  Could not find Google Place ID for ${placeId} (${name})`);
      return false;
    }
    googlePlaceId = foundId;
    console.log(`  ✓ Found Place ID: ${googlePlaceId}`);
  }

  console.log(`  🔍 Fetching photos for ${googlePlaceId}...`);
  const photoNames = fetchPhotoNames(googlePlaceId);
  
  if (photoNames.length === 0) {
    console.log(`  ⚠️  No photos found for ${placeId}`);
    return false;
  }

  console.log(`  📷 Found ${photoNames.length} photos, fetching URLs...`);
  
  const images = [];
  for (const name of photoNames.slice(0, MAX_PHOTOS)) {
    const url = fetchPhotoUrl(name);
    if (url) {
      const category = images.length === 0 ? 'exterior' : 'general';
      images.push({
        id: `photo-${images.length + 1}`,
        path: url,
        category,
        order: images.length + 1,
        source: 'google-places',
      });
      console.log(`    ✓ Photo ${images.length}: ${url.slice(0, 60)}...`);
    }
    await sleep(200); // Brief pause between photo fetches
  }

  if (images.length === 0) {
    console.log(`  ⚠️  Could not fetch any photo URLs for ${placeId}`);
    return false;
  }

  const newManifest = {
    place_id: placeId,
    images,
    _enriched: new Date().toISOString(),
    _source: 'enrich-accommodation-photos',
  };

  if (!DRY_RUN) {
    saveManifest(placeId, newManifest);
    console.log(`  ✅ Saved ${images.length} photos to manifest.json`);
  } else {
    console.log(`  [DRY RUN] Would save ${images.length} photos to manifest.json`);
  }
  return true;
}

/**
 * Look up Google Place ID for a card by name + city.
 * Returns ChIJ... place ID or null.
 */
function lookupPlaceId(name, city) {
  if (!name) return null;
  try {
    const query = city ? `${name} ${city}` : name;
    const result = execSync(`goplaces search ${JSON.stringify(query)} --json`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const data = JSON.parse(result);
    const places = data.places || data.results || (Array.isArray(data) ? data : []);
    if (places.length > 0) {
      return places[0].id || places[0].place_id || null;
    }
  } catch {
    // Try non-JSON
    try {
      const query = city ? `${name} ${city}` : name;
      const result = execSync(`goplaces search ${JSON.stringify(query)}`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const match = result.match(/ID:\s*(ChIJ\S+)/);
      return match ? match[1] : null;
    } catch { return null; }
  }
  return null;
}

// Main
const dirs = readdirSync(CARDS_DIR).filter(d => !d.startsWith('.'));
const accommodationCards = [];

for (const dir of dirs) {
  const card = loadCard(dir);
  if (!card) continue;
  const type = card.identity?.type || card.type;
  if (type !== 'accommodation') continue;
  if (dir === 'placecards') continue; // Skip meta entry
  accommodationCards.push(dir);
}

console.log(`Found ${accommodationCards.length} accommodation cards with Google Place IDs`);
if (DRY_RUN) console.log('DRY RUN — no files will be written');

let processed = 0, enriched = 0;
for (const placeId of accommodationCards.slice(0, LIMIT)) {
  const card = loadCard(placeId);
  const name = card?.identity?.name || placeId;
  console.log(`\n[${processed + 1}/${Math.min(accommodationCards.length, LIMIT)}] ${name} (${placeId})`);
  
  const result = await processCard(placeId);
  if (result) enriched++;
  processed++;
  
  await sleep(RATE_LIMIT_MS);
}

console.log(`\n✅ Done: ${enriched}/${processed} cards enriched with photos`);
