import { put, del, list } from '@vercel/blob';
import { readFileSync } from 'fs';

const CONTEXT_MAP = {
  'section:toronto-experiences': 'radar:toronto-experiences',
  'section:premium-grocery': 'radar:premium-grocery',
  'home:toronto': 'radar:toronto-experiences',
};

// Load V1 JSONL
const lines = readFileSync('/Users/john/.openclaw/workspace/vercel-briefing-app/data/disco/hourly-discoveries.jsonl', 'utf8').split('\n').filter(Boolean);
const allV1 = lines.map(l => JSON.parse(l));

// Normalize each
const normalized = allV1.map(d => {
  let contextKey = d.context || d.contextKey || '';
  contextKey = CONTEXT_MAP[contextKey] || contextKey;
  // Skip Vancouver (not relevant to active contexts)
  if (contextKey.includes('Vancouver')) return null;
  return {
    id: d.id || `v1-${d.name?.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.random().toString(36).slice(2,6)}`,
    name: d.name,
    type: d.type || 'restaurant',
    contextKey,
    place_id: d.place_id || d.placeId || '',
    heroImage: d.heroImage || (d.place_id ? `/place-photos/${d.place_id}/photos/1.jpg` : null),
    rating: d.rating,
    address: d.address || d.location,
    summary: d.summary || d.description,
    source: 'v1-migration',
  };
}).filter(d => d && d.name && d.contextKey);

// Load local-discoveries (cottages + developments)
const localRaw = JSON.parse(readFileSync('data/local-discoveries.json', 'utf8'));
const localDisc = Array.isArray(localRaw) ? localRaw : (localRaw.discoveries ?? []);

// Deduplicate by name+contextKey
const seen = new Set();
const deduped = [...normalized, ...localDisc].filter(d => {
  const key = `${d.name}|${d.contextKey}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Count by context
const counts = {};
for (const d of deduped) counts[d.contextKey] = (counts[d.contextKey] || 0) + 1;
console.log('Discoveries by context:');
Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
console.log('Total:', deduped.length);

// Write to Blob
const { blobs } = await list({ prefix: 'users/john/discoveries' });
for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(deduped), { access: 'public', addRandomSuffix: false });
console.log('Blob rebuilt');
