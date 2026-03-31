/**
 * Enrich cottages with Solar + Air Quality + Pollen data from Google APIs
 * Run: node scripts/enrich-cottage-solar-pollen.mjs
 * (reads GOOGLE_MAPS_KEY from .env.local)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// Read .env.local for GOOGLE_MAPS_KEY
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
const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ENV.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

if (!GOOGLE_KEY) {
  console.error('Error: GOOGLE_MAPS_KEY or NEXT_PUBLIC_GOOGLE_MAPS_KEY env var required');
  process.exit(1);
}

// Fetch solar potential
async function fetchSolar(lat, lng) {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const sunshineHours = data.solarPotential?.maxSunshineHoursPerYear;
    if (!sunshineHours) return null;
    const peakHrsJuly = Math.round((sunshineHours / 365) * 10) / 10;
    return { peakHrsJuly };
  } catch (e) {
    console.error('Solar API error:', e.message);
    return null;
  }
}

// Fetch air quality
async function fetchAirQuality(lat, lng) {
  const url = `https://airquality.googleapis.com/v1/currentConditions?key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: lat, longitude: lng } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const aqi = data.indexes?.find(i => i.code === 'uaqi')?.aqi;
    const category = data.indexes?.find(i => i.code === 'uaqi')?.category;
    if (!aqi) return null;
    return { aqi, category };
  } catch (e) {
    console.error('Air Quality API error:', e.message);
    return null;
  }
}

// Fetch pollen
async function fetchPollen(lat, lng) {
  const url = `https://pollen.googleapis.com/v1/forecast:lookup?location.latitude=${lat}&location.longitude=${lng}&days=3&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // Get July by finding the week with July in it (or use first available)
    const plantTypes = data.dailyForecast?.[0]?.plantCategories || [];
    const treePollen = plantTypes.find(p => p.type === 'TREE')?.category || '';
    const grassPollen = plantTypes.find(p => p.type === 'GRASS')?.category || '';
    if (!treePollen && !grassPollen) return null;
    return { tree: treePollen, grass: grassPollen };
  } catch (e) {
    console.error('Pollen API error:', e.message);
    return null;
  }
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function main() {
  const cottagesPath = './data/cottages/index.json';
  const cottagesRaw = readFileSync(cottagesPath, 'utf-8');
  const cottagesData = JSON.parse(cottagesRaw);

  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  // Process each cottage with coordinates
  (async () => {
    for (const cottage of cottagesData.cottages) {
      const coords = cottage.coordinates || cottage;
      const lat = coords.lat || cottage.lat;
      const lng = coords.lng || cottage.lng;

      if (!lat || !lng) {
        skipped++;
        continue;
      }

      console.log(`Processing: ${cottage.name} (${lat}, ${lng})`);

      try {
        // Fetch all three APIs with small delays
        const [solar, airQuality, pollen] = await Promise.all([
          fetchSolar(lat, lng).then(r => r && sleep(100), () => null),
          fetchAirQuality(lat, lng).then(r => r && sleep(100), () => null),
          fetchPollen(lat, lng).then(r => r && sleep(100), () => null),
        ]);

        // Re-fetch if promises didn't resolve properly
        const solarData = await fetchSolar(lat, lng);
        const airData = await fetchAirQuality(lat, lng);
        const pollenData = await fetchPollen(lat, lng);

        if (solarData) {
          cottage.solarPeakHrsJuly = solarData.peakHrsJuly;
          enriched++;
        }
        if (airData) {
          cottage.airQualityJuly = { aqi: airData.aqi, category: airData.category };
          enriched++;
        }
        if (pollenData) {
          cottage.pollenJulyTree = pollenData.tree;
          cottage.pollenJulyGrass = pollenData.grass;
          enriched++;
        }

        if (!solarData && !airData && !pollenData) {
          skipped++;
        }

        // Rate limit: 10 requests per second for these APIs
        await sleep(200);
      } catch (e) {
        console.error(`Error enriching ${cottage.name}:`, e.message);
        errors++;
      }
    }

    // Write back
    writeFileSync(cottagesPath, JSON.stringify(cottagesData, null, 2));
    console.log(`\nDone: enriched ${enriched} fields, skipped ${skipped}, errors ${errors}`);
  })();
}

main();