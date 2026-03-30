#!/usr/bin/env node
/**
 * qa-auto-fix.mjs — Auto-fix engine for Compass QA
 *
 * Tier-1 fixes (no human needed):
 *   - fetchAndUploadPhoto: Google Places → Blob → update discovery heroImage
 *   - fixCityFromAddress: extract city from address → update Blob discovery
 *   - createCardStub: create data/placecards/{id}/card.json + index entry
 *   - fixMapEmbed: validate place_id, update embed strategy
 *
 * Each fix records success/failure to qa-pattern-store.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { recordFixOutcome } from './qa-pattern-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  readFileSync(path, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)="?([^"]+)"?/);
    if (m) vars[m[1]] = m[2];
  });
  return vars;
}

const ENV = readEnvFile(join(REPO, '.env.local'));
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || ENV.BLOB_READ_WRITE_TOKEN;
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ENV.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const BLOB_BASE = 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function blobList(prefix) {
  const { list } = await import('@vercel/blob');
  return list({ prefix, limit: 1000 });
}

async function blobPutJSON(path, data) {
  const { put } = await import('@vercel/blob');
  return put(path, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

async function blobFetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function loadDiscoveries(userId = 'john') {
  const { blobs } = await blobList(`users/${userId}/discoveries`);
  if (!blobs[0]) return { raw: [], isArray: true };
  const raw = await blobFetchJSON(blobs[0].url);
  const isArray = Array.isArray(raw);
  const discoveries = isArray ? raw : (raw.discoveries || []);
  return { raw, isArray, discoveries, blobUrl: blobs[0].url };
}

async function saveDiscoveries(userId, raw, discoveries, isArray) {
  const { del } = await import('@vercel/blob');
  const { blobs } = await blobList(`users/${userId}/discoveries`);
  if (blobs[0]) await del(blobs[0].url);
  const payload = isArray ? discoveries : { ...raw, discoveries, updatedAt: new Date().toISOString() };
  await blobPutJSON(`users/${userId}/discoveries.json`, payload);
}

// ── Fix 1: Fetch and upload hero photo ────────────────────────────────────────

/**
 * Fetch photo from Google Places API, upload to Blob, update discovery heroImage.
 * @param {string} placeId - Google Place ID (ChIJ...)
 * @param {string} userId
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function fetchAndUploadPhoto(placeId, userId = 'john') {
  if (!GOOGLE_KEY) return { success: false, error: 'No Google API key' };

  try {
    // 1. Get photo reference from Places API
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos,name&key=${GOOGLE_KEY}`;
    const detailRes = await fetch(detailUrl);
    const detail = await detailRes.json();

    const photos = detail.result?.photos;
    if (!photos?.length) {
      return { success: false, error: 'No photos in Google Places' };
    }

    const photoRef = photos[0].photo_reference;

    // 2. Fetch the actual photo
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${photoRef}&key=${GOOGLE_KEY}`;
    const photoRes = await fetch(photoUrl);
    if (!photoRes.ok) {
      return { success: false, error: `Photo fetch failed: ${photoRes.status}` };
    }

    const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
    const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';

    // 3. Upload to Blob
    const { put } = await import('@vercel/blob');
    const blobResult = await put(`photos/places/${placeId}/hero.${ext}`, photoBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });

    const heroImageUrl = blobResult.url;

    // 4. Update discovery in Blob
    const { raw, isArray, discoveries } = await loadDiscoveries(userId);
    const idx = discoveries.findIndex(d => d.place_id === placeId);
    if (idx !== -1) {
      discoveries[idx].heroImage = heroImageUrl;
      await saveDiscoveries(userId, raw, discoveries, isArray);
    }

    recordFixOutcome(
      'hero_image missing or placeholder',
      'fetchAndUploadPhoto',
      true,
      { root_cause: 'No heroImage in discovery, fetched from Google Places API' }
    );

    console.log(`    📸 Photo uploaded for ${placeId}: ${heroImageUrl.slice(-50)}`);
    return { success: true, url: heroImageUrl };

  } catch (err) {
    recordFixOutcome('hero_image missing or placeholder', 'fetchAndUploadPhoto', false);
    return { success: false, error: err.message };
  }
}

// ── Fix 2: Extract city from address ─────────────────────────────────────────

/**
 * Extract city from address field, update discovery in Blob.
 * @param {string} discoveryId
 * @param {string} address
 * @param {string} contextKey - used to detect context-based city errors
 * @param {string} userId
 * @returns {Promise<{success: boolean, city?: string, error?: string}>}
 */
export async function fixCityFromAddress(discoveryId, address, contextKey = '', userId = 'john') {
  try {
    const city = extractCity(address, contextKey);
    if (!city) return { success: false, error: 'Could not extract city from address' };

    const { raw, isArray, discoveries } = await loadDiscoveries(userId);
    const idx = discoveries.findIndex(d => d.id === discoveryId);
    if (idx === -1) return { success: false, error: `Discovery ${discoveryId} not found` };

    const oldCity = discoveries[idx].city;
    discoveries[idx].city = city;
    await saveDiscoveries(userId, raw, discoveries, isArray);

    recordFixOutcome(
      'city label wrong or missing',
      'fixCityFromAddress',
      true,
      { root_cause: `city was "${oldCity}", extracted "${city}" from address` }
    );

    console.log(`    🏙  City fixed: ${oldCity || 'null'} → ${city} (${discoveryId.slice(0, 12)})`);
    return { success: true, city };

  } catch (err) {
    recordFixOutcome('city label wrong or missing', 'fixCityFromAddress', false);
    return { success: false, error: err.message };
  }
}

function extractCity(address, contextKey = '') {
  if (!address) return null;

  // Context-based override: if context says NYC but city says Toronto → New York
  const ctx = contextKey.toLowerCase();
  if (ctx.includes('nyc') || ctx.includes('new-york') || ctx.includes('brooklyn')) {
    return 'New York';
  }
  if (ctx.includes('boston')) return 'Boston';
  if (ctx.includes('toronto')) return 'Toronto';

  // Extract from address: "442 Graham Ave, Brooklyn, NY 11211, USA" → Brooklyn
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 3];
    if (candidate && !/^\d/.test(candidate) && !/^(USA|Canada|ON|NY|QC|BC)$/i.test(candidate) && candidate.length > 2) {
      return candidate;
    }
  }
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2];
    const stateZip = candidate.match(/^([A-Z]{2})\s+\d{5}/);
    if (!stateZip && candidate && !/^\d/.test(candidate)) {
      return candidate.replace(/\s+[A-Z]{2}\s+\d{5}.*$/, '').trim();
    }
  }
  return null;
}

// ── Fix 3: Create card stub ───────────────────────────────────────────────────

/**
 * Create a minimal card.json stub for a discovery, add to index.json.
 * @param {string} placeId
 * @param {Object} discovery - discovery object from Blob
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createCardStub(placeId, discovery) {
  try {
    const cardDir = join(REPO, 'data', 'placecards', placeId);
    const cardFile = join(cardDir, 'card.json');

    if (existsSync(cardFile)) {
      return { success: true, alreadyExists: true };
    }

    mkdirSync(cardDir, { recursive: true });

    const VALID_TYPES = new Set([
      'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
      'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
      'architecture', 'development', 'accommodation', 'neighbourhood',
    ]);

    const card = {
      place_id: placeId,
      name: discovery.name || '',
      type: VALID_TYPES.has(discovery.type) ? discovery.type : 'restaurant',
      address: discovery.address || null,
      city: discovery.city || null,
      rating: discovery.rating || null,
      hero_image: discovery.heroImage || null,
      stub: true,
    };

    writeFileSync(cardFile, JSON.stringify(card, null, 2) + '\n');

    // Update index.json
    const indexFile = join(REPO, 'data', 'placecards', 'index.json');
    let index = {};
    if (existsSync(indexFile)) {
      index = JSON.parse(readFileSync(indexFile, 'utf-8'));
    }
    index[placeId] = { name: card.name, type: card.type };
    writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');

    // Also upload to Blob place-cards/
    await blobPutJSON(`place-cards/${placeId}/card.json`, card);

    recordFixOutcome(
      'missing card stub',
      'createCardStub',
      true,
      { root_cause: 'Discovery had ChIJ place_id but no local card.json' }
    );

    console.log(`    📋 Card stub created: ${discovery.name || placeId.slice(0, 12)}`);
    return { success: true };

  } catch (err) {
    recordFixOutcome('missing card stub', 'createCardStub', false);
    return { success: false, error: err.message };
  }
}

// ── Fix dispatcher: maps issue severity → fix function ───────────────────────

/**
 * Attempt to auto-fix an issue based on its description and context.
 * @param {Object} issue - { issue, severity, fix_hint }
 * @param {Object} context - { placeId, discoveryId, address, contextKey }
 * @param {string} userId
 * @returns {Promise<{fixed: boolean, fix_type: string, result: Object}>}
 */
export async function attemptFix(issue, context = {}, userId = 'john') {
  const desc = (issue.issue || '').toLowerCase();
  const hint = (issue.fix_hint || '').toLowerCase();

  // Hero image missing/gradient
  if (
    (desc.includes('gradient') || desc.includes('placeholder') || desc.includes('no photo') || desc.includes('missing hero')) &&
    context.placeId?.startsWith('ChIJ')
  ) {
    const result = await fetchAndUploadPhoto(context.placeId, userId);
    return { fixed: result.success, fix_type: 'fetchAndUploadPhoto', result };
  }

  // Wrong city / missing city
  if (
    (desc.includes('wrong city') || desc.includes('city') || desc.includes('toronto') && desc.includes('brooklyn')) &&
    context.address && context.discoveryId
  ) {
    const result = await fixCityFromAddress(context.discoveryId, context.address, context.contextKey, userId);
    return { fixed: result.success, fix_type: 'fixCityFromAddress', result };
  }

  // Missing card stub
  if (
    (desc.includes('no card') || desc.includes('stub') || desc.includes('missing card')) &&
    context.placeId?.startsWith('ChIJ')
  ) {
    const result = await createCardStub(context.placeId, context.discovery || {});
    return { fixed: result.success, fix_type: 'createCardStub', result };
  }

  return { fixed: false, fix_type: 'none', result: { reason: 'No auto-fix available for this issue type' } };
}

// ── Batch fix runner ──────────────────────────────────────────────────────────

/**
 * Run auto-fixes on all auto-fixable issues from a scoring run.
 * @param {Array<{name: string, score: Object, url: string}>} scoredResults
 * @param {string} userId
 * @returns {Promise<{fixedCount: number, failedCount: number, skippedCount: number, details: Array}>}
 */
export async function runAutoFixes(scoredResults, userId = 'john') {
  let fixedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const details = [];

  // Load discoveries once for context
  const { discoveries } = await loadDiscoveries(userId).catch(() => ({ discoveries: [] }));
  const discoveryByPlaceId = Object.fromEntries(discoveries.map(d => [d.place_id, d]));

  for (const result of scoredResults) {
    if (!result.score?.issues) continue;
    const autoFixIssues = result.score.issues.filter(i => i.severity === 'auto-fix');
    if (!autoFixIssues.length) { skippedCount++; continue; }

    // Extract place_id from URL
    const placeIdMatch = result.url?.match(/\/placecards\/([^/?]+)/);
    const placeId = placeIdMatch?.[1];
    const discovery = placeId ? discoveryByPlaceId[placeId] : null;

    for (const issue of autoFixIssues) {
      console.log(`  🔧 Auto-fixing [${result.name}]: ${issue.issue.slice(0, 60)}`);

      const fixResult = await attemptFix(issue, {
        placeId,
        discoveryId: discovery?.id,
        address: discovery?.address,
        contextKey: discovery?.contextKey,
        discovery,
      }, userId);

      if (fixResult.fixed) {
        fixedCount++;
        details.push({ page: result.name, issue: issue.issue, fix: fixResult.fix_type, success: true });
      } else {
        failedCount++;
        details.push({ page: result.name, issue: issue.issue, fix: fixResult.fix_type, success: false, reason: fixResult.result?.reason || fixResult.result?.error });
      }

      // Small delay between fixes
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return { fixedCount, failedCount, skippedCount, details };
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const placeId = process.argv[3];

  if (action === 'photo' && placeId) {
    console.log(`\n📸 Fetching photo for ${placeId}...`);
    fetchAndUploadPhoto(placeId).then(r => console.log(r)).catch(console.error);
  } else if (action === 'city' && placeId) {
    const address = process.argv[4] || '';
    const contextKey = process.argv[5] || '';
    console.log(`\n🏙  Fixing city for ${placeId} from address: ${address}`);
    fixCityFromAddress(placeId, address, contextKey).then(r => console.log(r)).catch(console.error);
  } else {
    console.log('Usage: node scripts/qa-auto-fix.mjs photo <placeId>');
    console.log('       node scripts/qa-auto-fix.mjs city <discoveryId> <address> [contextKey]');
  }
}
