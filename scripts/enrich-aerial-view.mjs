#!/usr/bin/env node
/**
 * enrich-aerial-view.mjs
 *
 * For each cottage with lat/lng, calls the Google Maps Aerial View API.
 * If state === 'ACTIVE', saves aerialVideoUrl (MP4) and aerialVideoUrlWebm (WEBM)
 * to the cottage JSON in data/cottages/index.json.
 *
 * Usage:
 *   GOOGLE_MAPS_KEY=<key> node scripts/enrich-aerial-view.mjs
 *   OR if GOOGLE_MAPS_KEY is already in the environment or .env.local
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env.local if present
const envPath = resolve(ROOT, '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_KEY;
if (!API_KEY) {
  console.error('❌ No Google Maps API key found. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_MAPS_KEY.');
  process.exit(1);
}

const AERIAL_VIEW_BASE = 'https://aerialview.googleapis.com/v1/videos:lookupVideo';
const DELAY_MS = 300; // be polite between requests

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function lookupAerialView(lat, lng) {
  const url = `${AERIAL_VIEW_BASE}?lat=${lat}&lng=${lng}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    console.warn(`  ⚠️  HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function main() {
  const cottagesPath = resolve(ROOT, 'data/cottages/index.json');
  const raw = readFileSync(cottagesPath, 'utf-8');
  const data = JSON.parse(raw);
  const cottages = data.cottages;

  let updated = 0;
  let skipped = 0;
  let noData = 0;

  for (const cottage of cottages) {
    const lat = cottage.coordinates?.lat || cottage.lat || cottage.latitude;
    const lng = cottage.coordinates?.lng || cottage.lng || cottage.longitude;

    if (!lat || !lng) {
      console.log(`  ⏭  ${cottage.name || cottage.id} — no coordinates, skipping`);
      skipped++;
      continue;
    }

    // Skip if already enriched (re-run safe)
    if (cottage.aerialVideoUrl) {
      console.log(`  ✅ ${cottage.name || cottage.id} — already has aerial video`);
      updated++;
      continue;
    }

    console.log(`🔍 ${cottage.name || cottage.id} (${lat}, ${lng})...`);

    try {
      const result = await lookupAerialView(lat, lng);
      await sleep(DELAY_MS);

      if (!result) {
        console.log(`  ⚠️  No response for ${cottage.name || cottage.id}`);
        noData++;
        continue;
      }

      if (result.state === 'ACTIVE' && result.uris) {
        const mp4 = result.uris.MP4_HIGH || result.uris.MP4_MEDIUM;
        const webm = result.uris.WEBM;
        if (mp4) {
          cottage.aerialVideoUrl = mp4;
          cottage.aerialVideoUrlWebm = webm || null;
          console.log(`  🛸 ACTIVE — saved aerial video`);
          updated++;
        } else {
          console.log(`  ⚠️  ACTIVE but no MP4 URI`);
          noData++;
        }
      } else {
        console.log(`  📷 state=${result.state || 'unknown'} — using photo fallback`);
        noData++;
      }
    } catch (err) {
      console.error(`  ❌ Error for ${cottage.name || cottage.id}: ${err.message}`);
      noData++;
    }
  }

  writeFileSync(cottagesPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ Done: ${updated} aerial videos saved, ${noData} photo fallbacks, ${skipped} skipped (no coords)`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
