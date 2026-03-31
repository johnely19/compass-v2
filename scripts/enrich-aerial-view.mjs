/**
 * Enrich cottage data with aerial view video URLs from Google Aerial View API
 * Run: node --env-file=.env.local scripts/enrich-aerial-view.mjs
 */

import fs from 'fs';
import path from 'path';

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
if (!GOOGLE_MAPS_KEY) {
  console.error('Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY not found in environment');
  process.exit(1);
}

const COTTAGE_FILES = [
  'data/cottages/index.json',
  'data/cottages/concierge-cottages.json',
  'data/cottages/new-regions.json',
  'data/cottages/haliburton-disco.json',
];

async function lookupAerialVideo(lat, lng) {
  // Use address parameter with coordinates (API expects US-style address, lat,lng works as an address)
  const address = `${lat}, ${lng}`;
  const url = `https://aerialview.googleapis.com/v1/videos:lookupVideo?key=${GOOGLE_MAPS_KEY}&address=${encodeURIComponent(address)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // "Video not found" (404) or "API not enabled" (403) - just return null, no logging needed
      if (response.status === 404 || response.status === 403) {
        return null;
      }
      console.error(`  HTTP ${response.status}: ${await response.text()}`);
      return null;
    }
    const data = await response.json();
    if (data.state === 'ACTIVE' && data.uris) {
      return {
        aerialVideoUrl: data.uris.MP4_HIGH || data.uris.MP4_MEDIUM || null,
        aerialVideoUrlWebm: data.uris.WEBM || null,
      };
    }
    return null;
  } catch (error) {
    // Silently return null on network errors
    return null;
  }
}

async function enrichCottageFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  let data = JSON.parse(content);

  // Handle array vs { cottages: [] } structure
  let cottages = Array.isArray(data) ? data : (data.cottages || []);
  if (!Array.isArray(cottages)) {
    console.warn(`  Warning: ${filePath} has unexpected structure`);
    return { active: 0, notCovered: 0, processed: 0 };
  }

  let active = 0;
  let notCovered = 0;
  let processed = 0;

  for (const cottage of cottages) {
    // Get coordinates - check coordinates.lat/lng or direct lat/lng
    const lat = cottage.coordinates?.lat ?? cottage.lat ?? cottage.latitude;
    const lng = cottage.coordinates?.lng ?? cottage.lng ?? cottage.longitude;

    if (lat && lng) {
      processed++;
      const result = await lookupAerialVideo(lat, lng);
      if (result) {
        cottage.aerialVideoUrl = result.aerialVideoUrl;
        cottage.aerialVideoUrlWebm = result.aerialVideoUrlWebm;
        active++;
      } else {
        notCovered++;
      }
    }
  }

  // Save updated data back
  if (Array.isArray(data)) {
    data = cottages;
  } else {
    data.cottages = cottages;
  }

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  return { active, notCovered, processed };
}

async function main() {
  console.log('Starting aerial view enrichment...\n');
  console.log(`Using Google Maps key: ${GOOGLE_MAPS_KEY.substring(0, 10)}...\n`);

  let totalActive = 0;
  let totalNotCovered = 0;
  let totalProcessed = 0;

  for (const file of COTTAGE_FILES) {
    console.log(`Processing ${file}...`);
    const result = await enrichCottageFile(file);
    console.log(`  Processed: ${result.processed}, Active: ${result.active}, Not covered: ${result.notCovered}`);
    totalActive += result.active;
    totalNotCovered += result.notCovered;
    totalProcessed += result.processed;
  }

  console.log('\n--- Summary ---');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Active aerial videos: ${totalActive}`);
  console.log(`Not covered (no video available): ${totalNotCovered}`);
}

main().catch(console.error);