import { readFileSync, writeFileSync } from 'fs';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Fetch solar data from Google Solar API
 * Returns: { solarPeakHrsJuly: number, solarLabel: string } or null on failure
 */
async function fetchSolarData(lat, lng) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set, skipping solar data');
    return null;
  }

  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const maxSunshineHoursPerYear = data?.solarPotential?.maxSunshineHoursPerYear;
    if (!maxSunshineHoursPerYear) return null;

    const solarPeakHrsDay = Math.round((maxSunshineHoursPerYear / 365) * 10) / 10;
    const solarLabel = solarPeakHrsDay >= 6.5 ? 'Very High' :
      solarPeakHrsDay >= 5.5 ? 'High' :
        solarPeakHrsDay >= 4.5 ? 'Moderate' : 'Low';

    return { solarPeakHrsJuly: solarPeakHrsDay, solarLabel };
  } catch (err) {
    console.warn('⚠️ Solar API error:', err.message);
    return null;
  }
}

/**
 * Fetch air quality data from Google Air Quality API
 * Returns: { airQualityAqi: number, airQualityCategory: string } or null on failure
 */
async function fetchAirQualityData(lat, lng) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set, skipping air quality data');
    return null;
  }

  const url = `https://airquality.googleapis.com/v1/currentConditions?key=${API_KEY}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: lat, longitude: lng } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const aqi = data?.indexes?.[0]?.aqi;
    const category = data?.indexes?.[0]?.category;
    if (!aqi || !category) return null;

    return { airQualityAqi: aqi, airQualityCategory: category };
  } catch (err) {
    console.warn('⚠️ Air Quality API error:', err.message);
    return null;
  }
}

/**
 * Fetch pollen data from Google Pollen API
 * Returns: { pollenTree: string, pollenGrass: string } or null on failure
 */
async function fetchPollenData(lat, lng) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set, skipping pollen data');
    return null;
  }

  const url = `https://pollen.googleapis.com/v1/forecast:lookup?location.latitude=${lat}&location.longitude=${lng}&days=3&key=${API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const dailyInfo = data?.dailyInfo;
    if (!dailyInfo || dailyInfo.length === 0) return null;

    const firstDay = dailyInfo[0];
    const pollenTypeInfo = firstDay?.pollenTypeInfo || [];

    let pollenTree = null;
    let pollenGrass = null;

    for (const pt of pollenTypeInfo) {
      const code = pt?.code?.toLowerCase();
      const category = pt?.indexInfo?.category;
      if (!category) continue;
      if (code === 'tree' || code === 'tree_pollen') {
        pollenTree = category;
      } else if (code === 'grass' || code === 'grass_pollen') {
        pollenGrass = category;
      }
    }

    if (!pollenTree && !pollenGrass) return null;
    return { pollenTree, pollenGrass };
  } catch (err) {
    console.warn('⚠️ Pollen API error:', err.message);
    return null;
  }
}

/**
 * Enrich a single cottage with solar, air quality, and pollen data
 */
async function enrichCottage(cottage) {
  const lat = cottage.coordinates?.lat || cottage.latitude;
  const lng = cottage.coordinates?.lng || cottage.longitude;

  if (!lat || !lng) {
    return cottage;
  }

  const enriched = { ...cottage };

  // Fetch all three data sources in parallel
  const [solarData, airQualityData, pollenData] = await Promise.all([
    fetchSolarData(lat, lng),
    fetchAirQualityData(lat, lng),
    fetchPollenData(lat, lng),
  ]);

  if (solarData) {
    enriched.solarPeakHrsJuly = solarData.solarPeakHrsJuly;
    enriched.solarLabel = solarData.solarLabel;
  }

  if (airQualityData) {
    enriched.airQualityAqi = airQualityData.airQualityAqi;
    enriched.airQualityCategory = airQualityData.airQualityCategory;
  }

  if (pollenData) {
    enriched.pollenTree = pollenData.pollenTree;
    enriched.pollenGrass = pollenData.pollenGrass;
  }

  return enriched;
}

// Main
async function main() {
  const cottagesPath = './data/cottages/index.json';
  const cottagesRaw = readFileSync(cottagesPath, 'utf-8');
  const cottagesData = JSON.parse(cottagesRaw);

  let enrichedCount = 0;

  for (const cottage of cottagesData.cottages) {
    // Only enrich cottages with coordinates
    if (!cottage.coordinates?.lat && !cottage.latitude) continue;

    const before = JSON.stringify(cottage);
    const enriched = await enrichCottage(cottage);
    const after = JSON.stringify(enriched);

    if (before !== after) {
      Object.assign(cottage, enriched);
      enrichedCount++;
    }
  }

  // Write back
  writeFileSync(cottagesPath, JSON.stringify(cottagesData, null, 2));

  console.log(`Enriched ${enrichedCount} cottages with solar/air/pollen data`);
}

main().catch(console.error);