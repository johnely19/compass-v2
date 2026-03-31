// Usage: node scripts/enrich-street-view.mjs
// Requires: NEXT_PUBLIC_GOOGLE_MAPS_KEY in .env.local

import fs from 'fs';
import path from 'path';

const COTTAGES_PATH = path.join(process.cwd(), 'data', 'cottages', 'index.json');
const ENV_PATH = path.join(process.cwd(), '.env.local');

function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_PATH)) {
    console.error('❌ .env.local not found');
    process.exit(1);
  }
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      env[key] = value;
    }
  }
  return env;
}

function getCoords(cottage) {
  // Try coordinates object first
  if (cottage.coordinates?.lat && cottage.coordinates?.lng) {
    return { lat: cottage.coordinates.lat, lng: cottage.coordinates.lng };
  }
  // Fall back to top-level lat/lng
  if (cottage.lat != null && cottage.lng != null) {
    return { lat: cottage.lat, lng: cottage.lng };
  }
  return null;
}

async function main() {
  const env = loadEnv();
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) {
    console.error('❌ NEXT_PUBLIC_GOOGLE_MAPS_KEY not found in .env.local');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(COTTAGES_PATH, 'utf8'));
  const cottages = data.cottages || [];

  let updated = 0;
  let skipped = 0;

  for (const cottage of cottages) {
    // Skip if already has heroImage
    if (cottage.heroImage) {
      skipped++;
      continue;
    }

    const coords = getCoords(cottage);
    if (!coords) {
      console.log(`⏭️  no coords for ${cottage.id}`);
      skipped++;
      continue;
    }

    // Call Street View Metadata API
    const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${coords.lat},${coords.lng}&key=${apiKey}`;
    const metaRes = await fetch(metadataUrl);
    const meta = await metaRes.json();

    if (meta.status === 'OK') {
      cottage.heroImage = `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${coords.lat},${coords.lng}&key=${apiKey}&fov=90&pitch=0`;
      cottage.heroSource = 'street-view';
      console.log(`✅ added street view for ${cottage.id}`);
      updated++;
    } else {
      console.log(`⏭️  no street view for ${cottage.id} (${meta.status})`);
      skipped++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // Write back
  fs.writeFileSync(COTTAGES_PATH, JSON.stringify(data, null, 2));
  console.log(`\n📊 Summary: ${updated} updated, ${skipped} skipped`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});