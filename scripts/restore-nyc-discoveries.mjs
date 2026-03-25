import { put, del, list } from '@vercel/blob';
import { readFileSync } from 'fs';

const BLOB_BASE = 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

// Load V1 NYC discoveries
const lines = readFileSync('/Users/john/.openclaw/workspace/vercel-briefing-app/data/disco/hourly-discoveries.jsonl', 'utf8').split('\n').filter(Boolean);
const allV1 = lines.map(l => JSON.parse(l));
const nycV1 = allV1.filter(d => d.context === 'trip:nyc-april-2026' || d.contextKey === 'trip:nyc-april-2026');

console.log('V1 NYC discoveries:', nycV1.length);

// Normalize to V2 format
const normalized = nycV1.map(d => ({
  id: d.id || `nyc-${d.name?.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
  name: d.name,
  type: d.type || 'restaurant',
  contextKey: 'trip:nyc-april-2026',
  place_id: d.place_id || d.placeId || '',
  heroImage: d.heroImage || (d.place_id ? `/place-photos/${d.place_id}/photos/1.jpg` : null),
  rating: d.rating,
  address: d.address || d.location,
  summary: d.summary || d.description,
  source: d.source || 'v1-migration',
})).filter(d => d.name);

// Load current Blob discoveries
const { blobs } = await list({ prefix: 'users/john/discoveries' });
const existing = blobs.length ? await (await fetch(blobs[0].url)).json() : [];
const existingDisc = Array.isArray(existing) ? existing : existing.discoveries || [];

// Remove existing NYC entries, add V1 ones
const nonNyc = existingDisc.filter(d => d.contextKey !== 'trip:nyc-april-2026');
const merged = [...nonNyc, ...normalized];

console.log('Non-NYC preserved:', nonNyc.length);
console.log('NYC restored:', normalized.length);
console.log('Total after merge:', merged.length);

// Write back
for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(merged), { access: 'public', addRandomSuffix: false });
console.log('Blob updated');
