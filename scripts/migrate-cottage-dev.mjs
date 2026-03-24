#!/usr/bin/env node
/**
 * Migrate cottages + developments into discoveries format.
 * Writes to data/local-discoveries.json which the homepage can load.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// Load cottages
const cottagesRaw = JSON.parse(readFileSync(join(ROOT, 'data/cottages/index.json'), 'utf8'));
const cottages = cottagesRaw.cottages || [];

// Load developments
const devsRaw = JSON.parse(readFileSync(join(ROOT, 'data/developments/index.json'), 'utf8'));
const developments = devsRaw.developments || [];

const discoveries = [];

// Convert cottages → discoveries for trip:cottage-july-2026
for (const c of cottages) {
  discoveries.push({
    id: `cottage_${c.id}`,
    place_id: c.id,
    name: c.name,
    address: c.region || '',
    city: c.region || 'Ontario',
    type: 'accommodation',
    rating: c.swimScore || undefined,
    contextKey: 'trip:cottage-july-2026',
    source: 'disco:cottage-scan',
    discoveredAt: '2026-03-15T00:00:00.000Z',
    placeIdStatus: 'missing',
    heroImage: c.heroImage || (c.images && c.images[0]) || undefined,
    // Extra fields for rendering
    _cottage: {
      beds: c.beds,
      baths: c.baths,
      sleeps: c.sleeps,
      pricePerWeek: c.pricePerWeek,
      swimType: c.swimType,
      swimVerdict: c.swimVerdict,
      platform: c.platform,
      url: c.url,
      amenities: c.amenities,
    },
  });
}

// Convert developments → discoveries for radar:developments
for (const d of developments) {
  discoveries.push({
    id: `dev_${d.id}`,
    place_id: d.placeId || d.id,
    name: d.name,
    address: d.location || '',
    city: 'Toronto',
    type: 'development',
    contextKey: 'radar:developments',
    source: 'disco:development-scan',
    discoveredAt: '2026-03-17T00:00:00.000Z',
    placeIdStatus: d.placeId ? 'verified' : 'missing',
    heroImage: (d.images && d.images[0]) || undefined,
    _development: {
      status: d.status,
      developer: d.developer,
      architect: d.architect,
      height: d.heightStoreys,
      units: d.units,
      neighbourhood: d.neighbourhood,
    },
  });
}

const output = {
  discoveries,
  updatedAt: new Date().toISOString(),
  note: 'Auto-generated from data/cottages/ and data/developments/',
};

writeFileSync(join(ROOT, 'data/local-discoveries.json'), JSON.stringify(output, null, 2));
console.log(`Wrote ${discoveries.length} discoveries (${cottages.length} cottages + ${developments.length} developments)`);
