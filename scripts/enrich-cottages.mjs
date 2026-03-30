import { readFileSync, writeFileSync } from 'fs';

// Price lookup for CottageStays cottages (July peak-week estimates)
const PRICE_LOOKUP = {
  'the-lookout': 2800,
  'sunset-paradise': 2600,
  'willowcrest': 2700,
  'cedar-shore': 2900,
  'the-signal': 3200,
  'huron-shores': 2500,
  'blue-bluff-beauty': 2400,
  'pine-view-cottage': 2300,
  'cedarhaven': 2400,
  'sunset-ridge': 2500,
  'turkey-perch': 2600,
  'modern-classic': 2800,
  'carruthers-cottage': 2200,
  'wexford-cottage': 2300,
  'twilight-haven': 2400,
  'blue-haven-lakehouse': 2600,
  'hideaway': 3100,
  'bedrock-beach-house': 3400,
  'sunset-serenity-shorehouse': 2800,
  'lakeshore-sunsets': 2700,
  'jervis-bay': 2200,
  'sandpiper-cottage': 1800,
  'charming-bayfield-cottage': 2000,
  'martins-point-cottage': 2600,
};

// Toronto coordinates
const TORONTO = { lat: 43.6532, lng: -79.3832 };

// Haversine formula to calculate distance in km
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate drive time from Toronto
function calcDriveTime(lat, lng) {
  if (!lat || !lng) return null;
  const km = haversineKm(TORONTO.lat, TORONTO.lng, lat, lng);
  const roadKm = km * 1.3; // Road distance factor
  const hours = roadKm / 90; // 90 km/h average speed
  const minutes = Math.round(hours * 60);
  const roundedMinutes = Math.round(minutes / 5) * 5; // Round to nearest 5

  let label;
  if (roundedMinutes < 60) {
    label = `${roundedMinutes}min`;
  } else {
    const h = Math.floor(roundedMinutes / 60);
    const m = roundedMinutes % 60;
    if (m === 0) {
      label = `${h}h`;
    } else {
      label = `${h}h ${m}min`;
    }
  }

  return { minutes: roundedMinutes, label };
}

// Derive vibe tags from cottage fields
function deriveVibeTags(cottage) {
  const tags = [];
  const gates = cottage.gates;
  const swimType = cottage.swimType;
  const amenities = cottage.amenities;
  const notes = cottage.notes;
  const sleeps = cottage.sleeps;

  if (gates?.private) tags.push('🔒 All to yourself');
  if (gates?.shoreline) tags.push('🌊 Crown land shoreline');
  if (gates?.dockAccess) tags.push('⛵ Dock access');
  if (swimType?.toLowerCase().includes('sandy')) tags.push('🏖 Sandy beach');
  else if (swimType?.toLowerCase().includes('rocky')) tags.push('🪨 Rocky shore');
  else if (swimType) tags.push(`🏊 ${swimType}`);
  if (amenities?.some(a => a.toLowerCase().includes('hot tub'))) tags.push('♨️ Hot tub');
  if (amenities?.some(a => a.toLowerCase().includes('sauna'))) tags.push('🧖 Sauna');
  if (amenities?.some(a => a.toLowerCase().includes('kayaks'))) tags.push('🛶 Kayaks');
  if (amenities?.some(a => a.toLowerCase().includes('dock'))) tags.push('⛵ Dock');
  if (notes?.toLowerCase().includes('very private') || notes?.toLowerCase().includes('private island')) tags.push('🌿 Very private');
  if (notes?.toLowerCase().includes('island')) tags.push('🏝 Island setting');
  if (sleeps) tags.push(`👥 Sleeps ${sleeps}`);

  // Cap at 4 tags
  return tags.slice(0, 4);
}

// Enrich a single cottage
function enrichCottage(cottage, placeId) {
  const enriched = { ...cottage };

  // Add vibeTags
  enriched.vibeTags = deriveVibeTags(cottage);

  // Add drive time from Toronto
  const coords = cottage.coordinates;
  if (coords?.lat && coords?.lng) {
    const driveTime = calcDriveTime(coords.lat, coords.lng);
    if (driveTime) {
      enriched.driveTimeMinutes = driveTime.minutes;
      enriched.driveTimeLabel = driveTime.label;
    }
  }

  // Add estimated price for CottageStays cottages
  const platform = cottage.platform;
  const pricePerWeek = cottage.pricePerWeek;
  if (platform === 'CottageStays' && (pricePerWeek === null || pricePerWeek === undefined)) {
    const estimatedPrice = PRICE_LOOKUP[placeId];
    if (estimatedPrice) {
      enriched.pricePerWeek = estimatedPrice;
      enriched.priceEstimated = true;
    }
  }

  return enriched;
}

// Main
function main() {
  // Load local-discoveries.json
  const discoPath = './data/local-discoveries.json';
  const discoRaw = readFileSync(discoPath, 'utf-8');
  const disco = JSON.parse(discoRaw);

  // Load cottages/index.json
  const cottagesPath = './data/cottages/index.json';
  const cottagesRaw = readFileSync(cottagesPath, 'utf-8');
  const cottagesData = JSON.parse(cottagesRaw);

  // Create cottages map for quick lookup
  const cottagesMap = new Map();
  for (const c of cottagesData.cottages) {
    cottagesMap.set(c.place_id, c);
  }

  // Enrich discoveries for trip:cottage-july-2026
  let enrichedCount = 0;
  for (const discovery of disco.discoveries) {
    if (discovery.contextKey === 'trip:cottage-july-2026' && discovery._cottage) {
      const placeId = discovery.place_id;
      discovery._cottage = enrichCottage(discovery._cottage, placeId);
      enrichedCount++;
    }
  }

  // Enrich cottages index
  for (const cottage of cottagesData.cottages) {
    const placeId = cottage.place_id;
    if (cottage.platform === 'CottageStays' || cottage.platform === 'Airbnb' || cottage.platform === 'VRBO') {
      // Only enrich cottages that are part of the trip
      const discovery = disco.discoveries.find(
        d => d.place_id === placeId && d.contextKey === 'trip:cottage-july-2026'
      );
      if (discovery?._cottage) {
        // Copy enriched fields from discovery
        cottage.vibeTags = discovery._cottage.vibeTags;
        cottage.driveTimeMinutes = discovery._cottage.driveTimeMinutes;
        cottage.driveTimeLabel = discovery._cottage.driveTimeLabel;
        cottage.pricePerWeek = discovery._cottage.pricePerWeek;
        cottage.priceEstimated = discovery._cottage.priceEstimated;
      }
    }
  }

  // Write back
  writeFileSync(discoPath, JSON.stringify(disco, null, 2));
  writeFileSync(cottagesPath, JSON.stringify(cottagesData, null, 2));

  console.log(`Enriched ${enrichedCount} cottages`);
}

main();
