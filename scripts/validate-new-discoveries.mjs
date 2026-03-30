#!/usr/bin/env node
/* ============================================================
   Compass V2 — Discovery Validation & Auto-Enrichment (Layer 2)

   What this does:
   1. Loads all Blob discoveries for every user
   2. For each missing city: extracts from address field
   3. For each missing heroImage with a valid place_id: fetches photo
      reference from Google Places API and uploads to Blob
   4. For each missing card stub: creates minimal card.json in data/placecards/
   5. Updates data/placecards/index.json
   6. Writes patched discoveries back to Blob

   Usage:
     node scripts/validate-new-discoveries.mjs               (dry-run)
     node scripts/validate-new-discoveries.mjs --write       (write changes)
     node scripts/validate-new-discoveries.mjs --user=huzur  (specific user)

   Can be run manually or triggered after Disco pushes.
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// Args
const WRITE = process.argv.includes('--write');
const USER_FILTER = process.argv.find(a => a.startsWith('--user='))?.split('=')[1];
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Config
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN
  || readEnvFile(join(REPO, '.env.local'))?.BLOB_READ_WRITE_TOKEN;
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
  || readEnvFile(join(REPO, '.env.local'))?.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const BLOB_BASE = 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';
const BLOB_API = 'https://blob.vercel-storage.com';
const PLACES_DIR = join(REPO, 'data', 'placecards');
const INDEX_FILE = join(PLACES_DIR, 'index.json');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  readFileSync(path, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)="?([^"]+)"?/);
    if (m) vars[m[1]] = m[2];
  });
  return vars;
}

function log(msg) { console.log(msg); }
function verbose(msg) { if (VERBOSE) console.log(`    ${msg}`); }

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function blobList(prefix) {
  const url = `${BLOB_API}?prefix=${encodeURIComponent(prefix)}&limit=500&token=${BLOB_TOKEN}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
  if (!res.ok) throw new Error(`Blob list failed: ${res.status}`);
  const data = await res.json();
  return data.blobs || [];
}

async function blobFetchJSON(blobUrl) {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status} ${blobUrl}`);
  return res.json();
}

async function blobPut(path, content) {
  if (!WRITE) { verbose(`[dry-run] Would write: ${path}`); return; }
  const res = await fetch(`${BLOB_API}/${path}?token=${BLOB_TOKEN}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      'Content-Type': 'application/json',
      'x-add-random-suffix': 'false',
    },
    body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  });
  if (!res.ok) throw new Error(`Blob put failed: ${res.status}`);
  return res.json();
}

// ── Google Places helpers ─────────────────────────────────────────────────────

async function fetchPlacePhoto(placeId) {
  if (!GOOGLE_KEY) return null;
  try {
    // 1. Get place details to find photo reference
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos,name,formatted_address,geometry&key=${GOOGLE_KEY}`;
    const res = await fetch(detailUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const photos = data.result?.photos;
    if (!photos?.length) return null;
    // Return the photo reference for the first photo
    return photos[0].photo_reference;
  } catch { return null; }
}

async function getPhotoUrl(photoRef, maxWidth = 800) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_KEY}`;
}

// ── City extraction ───────────────────────────────────────────────────────────

function extractCityFromAddress(address) {
  if (!address) return null;
  // "442 Graham Ave, Brooklyn, NY 11211, USA" → "Brooklyn"
  // "156 10th Ave, New York, NY 10011" → "New York"
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 3] || parts[parts.length - 2];
    if (candidate && !/^\d/.test(candidate) && !/^(USA|Canada|ON|NY|QC)$/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeCityForContext(city, contextKey) {
  if (!contextKey || !city) return city;
  const key = contextKey.toLowerCase();
  // If context is NYC-related but city says Toronto → fix
  if ((key.includes('nyc') || key.includes('new-york') || key.includes('brooklyn')) && 
      city.toLowerCase() === 'toronto') {
    return 'New York';
  }
  return city;
}

// ── Card stub creation ────────────────────────────────────────────────────────

function loadIndex() {
  if (!existsSync(INDEX_FILE)) return {};
  return JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
}

function saveIndex(index) {
  if (!WRITE) { verbose('[dry-run] Would update index.json'); return; }
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');
}

function createCardStub(discovery) {
  const placeId = discovery.place_id;
  if (!placeId) return false;

  const cardDir = join(PLACES_DIR, placeId);
  const cardFile = join(cardDir, 'card.json');

  if (existsSync(cardFile)) {
    verbose(`Stub exists: ${placeId.slice(0, 12)}...`);
    return false;
  }

  const card = {
    place_id: placeId,
    name: discovery.name || '',
    type: discovery.type || 'restaurant',
    address: discovery.address || null,
    city: discovery.city || null,
    rating: discovery.rating || null,
    hero_image: discovery.heroImage || null,
    stub: true,
  };

  if (WRITE) {
    mkdirSync(cardDir, { recursive: true });
    writeFileSync(cardFile, JSON.stringify(card, null, 2) + '\n');
  }

  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processUser(userId) {
  log(`\n  👤 User: ${userId}`);

  // Load discoveries
  const blobs = await blobList(`users/${userId}/discoveries`);
  if (!blobs.length) { log(`    No discoveries blob found`); return {}; }

  let data = await blobFetchJSON(blobs[0].url);
  let discoveries = Array.isArray(data) ? data : (data.discoveries || []);
  log(`    ${discoveries.length} discoveries loaded`);

  const index = loadIndex();
  let modified = false;
  const stats = { cityFixed: 0, stubCreated: 0, heroFetched: 0, errors: 0 };

  for (const d of discoveries) {
    // ── 1. Fix wrong city ──────────────────────────────────
    const fixedCity = normalizeCityForContext(d.city, d.contextKey);
    if (fixedCity !== d.city) {
      verbose(`City fix: ${d.name}: ${d.city} → ${fixedCity}`);
      d.city = fixedCity;
      modified = true;
      stats.cityFixed++;
    }

    // ── 2. Extract city from address if missing ────────────
    if (!d.city && d.address) {
      const extracted = extractCityFromAddress(d.address);
      if (extracted) {
        verbose(`City extract: ${d.name}: "${extracted}" from address`);
        d.city = extracted;
        modified = true;
        stats.cityFixed++;
      }
    }

    // ── 3. Fetch hero image if missing and has place_id ────
    if (!d.heroImage && d.place_id?.startsWith('ChIJ') && GOOGLE_KEY) {
      try {
        const photoRef = await fetchPlacePhoto(d.place_id);
        if (photoRef) {
          const photoUrl = await getPhotoUrl(photoRef);
          verbose(`Hero fetch: ${d.name} — got photo reference`);
          d.heroImage = photoUrl;
          modified = true;
          stats.heroFetched++;
        }
      } catch (err) {
        verbose(`Hero fetch error for ${d.name}: ${err.message}`);
        stats.errors++;
      }
      // Rate limit: 10 req/s
      await new Promise(r => setTimeout(r, 120));
    }

    // ── 4. Create card stub ────────────────────────────────
    if (d.place_id?.startsWith('ChIJ')) {
      const created = createCardStub(d);
      if (created) {
        index[d.place_id] = { name: d.name || '', type: d.type || 'restaurant' };
        stats.stubCreated++;
        verbose(`Stub: ${d.name} (${d.place_id.slice(0, 12)}...)`);
      }
    }
  }

  // Save index
  if (stats.stubCreated > 0) saveIndex(index);

  // Write patched discoveries back to Blob
  if (modified) {
    const blobPath = `users/${userId}/discoveries.json`;
    const payload = Array.isArray(data)
      ? discoveries
      : { ...data, discoveries, updatedAt: new Date().toISOString() };
    await blobPut(blobPath, payload);
    log(`    ✅ Wrote patched discoveries to Blob`);
  }

  log(`    City fixes: ${stats.cityFixed} | Hero images: ${stats.heroFetched} | Stubs: ${stats.stubCreated} | Errors: ${stats.errors}`);
  return stats;
}

async function main() {
  console.log(`\n🔍 Compass V2 — Discovery Validation & Auto-Enrichment`);
  console.log(`   Mode: ${WRITE ? '✍️  WRITE (changes will be saved)' : '🔎 DRY-RUN (no changes)'}`);
  if (!WRITE) console.log(`   Run with --write to apply changes\n`);

  if (!BLOB_TOKEN) {
    console.error('❌ BLOB_READ_WRITE_TOKEN not found. Check .env.local');
    process.exit(1);
  }

  // Find all users
  let userIds;
  if (USER_FILTER) {
    userIds = [USER_FILTER];
  } else {
    const blobs = await blobList('users/');
    // Extract unique user IDs from paths like "users/john/discoveries.json"
    userIds = [...new Set(
      blobs
        .map(b => b.pathname?.match(/^users\/([^/]+)\//)?.[1])
        .filter(Boolean)
    )];
  }

  log(`  Found ${userIds.length} user(s): ${userIds.join(', ')}`);

  const totalStats = { cityFixed: 0, stubCreated: 0, heroFetched: 0, errors: 0 };

  for (const userId of userIds) {
    try {
      const stats = await processUser(userId);
      for (const k of Object.keys(totalStats)) totalStats[k] += stats[k] || 0;
    } catch (err) {
      console.error(`  ❌ Error processing user ${userId}: ${err.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Total: ${totalStats.cityFixed} cities fixed, ${totalStats.heroFetched} heroes fetched, ${totalStats.stubCreated} stubs created, ${totalStats.errors} errors`);

  if (WRITE && totalStats.stubCreated > 0) {
    console.log(`\n  💾 ${totalStats.stubCreated} new card stubs written to data/placecards/`);
    console.log(`  ⚠️  Remember to git add data/placecards/ && git commit && git push`);
  }

  console.log();
  process.exit(totalStats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  process.exit(1);
});
