/**
 * enrich-cottage-aerial.mjs
 *
 * For each cottage with coordinates, calls the Google Maps Aerial View API.
 * If state === 'ACTIVE', saves aerialVideoUrl (MP4) and aerialVideoUrlWebm to
 * the cottage's JSON. Skips cottages that already have a video URL.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=<key> node scripts/enrich-cottage-aerial.mjs
 *   node scripts/enrich-cottage-aerial.mjs --dry-run
 *   node scripts/enrich-cottage-aerial.mjs --force   # re-fetch even if already set
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', 'data', 'cottages', 'index.json');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.MAPS_KEY || '';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const AERIAL_API = 'https://aerialview.googleapis.com/v1/videos:lookupVideo';

async function lookupAerialVideo(lat, lng) {
  if (!API_KEY) return null;
  const url = `${AERIAL_API}?lat=${lat}&lng=${lng}&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403) throw new Error('API key not authorized for Aerial View API');
      return null; // 404 = no coverage
    }
    const data = await res.json();
    if (data.state !== 'ACTIVE') return null;
    return {
      mp4: data.uris?.MP4_HIGH || data.uris?.MP4_MEDIUM || null,
      webm: data.uris?.WEBM || null,
    };
  } catch (err) {
    if (err.message?.includes('not authorized')) throw err;
    return null;
  }
}

async function main() {
  if (!API_KEY && !DRY_RUN) {
    console.warn('⚠️  No GOOGLE_MAPS_API_KEY set — running in dry-run mode');
  }

  const raw = readFileSync(INDEX_PATH, 'utf8');
  const data = JSON.parse(raw);
  const cottages = data.cottages || [];

  let skipped = 0, fetched = 0, found = 0, noData = 0, errors = 0;

  for (const cottage of cottages) {
    const lat = cottage.coordinates?.lat || cottage.lat;
    const lng = cottage.coordinates?.lng || cottage.lng;

    if (!lat || !lng) {
      console.log(`  ⏭  ${cottage.id}: no coordinates, skipping`);
      skipped++;
      continue;
    }

    if (!FORCE && cottage.aerialVideoUrl) {
      console.log(`  ✓  ${cottage.id}: already has aerial video, skipping`);
      skipped++;
      continue;
    }

    if (DRY_RUN || !API_KEY) {
      console.log(`  🔍 ${cottage.id}: would fetch aerial for (${lat}, ${lng})`);
      fetched++;
      continue;
    }

    try {
      const result = await lookupAerialVideo(lat, lng);
      fetched++;

      if (result?.mp4) {
        cottage.aerialVideoUrl = result.mp4;
        cottage.aerialVideoUrlWebm = result.webm || null;
        console.log(`  🛸 ${cottage.id}: ACTIVE — ${result.mp4.slice(0, 60)}...`);
        found++;
      } else {
        // No coverage — clear any stale URL
        delete cottage.aerialVideoUrl;
        delete cottage.aerialVideoUrlWebm;
        console.log(`  —  ${cottage.id}: no aerial coverage`);
        noData++;
      }

      // Polite rate limit: 50ms between requests
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      console.error(`  ✗  ${cottage.id}: ${err.message}`);
      errors++;
      if (err.message?.includes('not authorized')) {
        console.error('Aborting: API key not authorized for Aerial View API.');
        console.error('Enable it at: https://console.cloud.google.com/apis/library/aerialview.googleapis.com');
        break;
      }
    }
  }

  if (!DRY_RUN && API_KEY) {
    writeFileSync(INDEX_PATH, JSON.stringify(data, null, 2));
    console.log(`\nSaved ${INDEX_PATH}`);
  }

  console.log(`\nDone: ${fetched} fetched, ${found} with aerial, ${noData} no coverage, ${skipped} skipped, ${errors} errors`);
}

main().catch(console.error);
