import { put, del, list } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const cardsDir = path.join(process.cwd(), 'data', 'placecards');
const cardDirs = fs.readdirSync(cardsDir).filter(d => !d.startsWith('.'));
const nameMap = new Map();

for (const dir of cardDirs) {
  try {
    const card = JSON.parse(fs.readFileSync(path.join(cardsDir, dir, 'card.json'), 'utf8'));
    const name = (card.identity?.name || card.name || '').toLowerCase().trim();
    if (name && dir.startsWith('ChIJ')) {
      nameMap.set(name, dir);
    }
  } catch {}
}
console.log('Place card index:', nameMap.size, 'cards with names');

const { blobs } = await list({ prefix: 'users/john/discoveries' });
const res = await fetch(blobs[0].url);
const disc = await res.json();
const discoveries = Array.isArray(disc) ? disc : disc.discoveries || [];

let matched = 0, alreadyHad = 0;
for (const d of discoveries) {
  if (d.place_id && d.place_id.startsWith('ChIJ')) { alreadyHad++; continue; }
  const name = (d.name || '').toLowerCase().trim();
  const placeId = nameMap.get(name);
  if (placeId) {
    d.place_id = placeId;
    d.heroImage = '/place-photos/' + placeId + '/photos/1.jpg';
    d.placeIdStatus = 'verified';
    matched++;
  }
}

console.log('Already had place_id:', alreadyHad);
console.log('Newly matched by name:', matched);
console.log('Still unmatched:', discoveries.length - alreadyHad - matched);

for (const b of blobs) await del(b.url);
await put('users/john/discoveries.json', JSON.stringify(discoveries), { access: 'public', addRandomSuffix: false });
console.log('Updated Blob');
