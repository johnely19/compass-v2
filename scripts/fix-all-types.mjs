#!/usr/bin/env node
/* ============================================================
   Fix type misclassification in both Blob + card.json files.
   #77 — grocery stores, galleries, bars showing as 'restaurant'
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { put, list, del } from '@vercel/blob';

const CARDS_DIR = join(process.cwd(), 'data', 'placecards');
const DRY_RUN = process.argv.includes('--dry-run');

const VALID_TYPES = new Set([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

// Google Places primaryType → Compass type
const GOOGLE_TYPE_MAP = {
  grocery_store: 'grocery', supermarket: 'grocery', food_store: 'grocery',
  convenience_store: 'grocery', health_food_store: 'grocery',
  art_gallery: 'gallery', gallery: 'gallery',
  museum: 'museum',
  bar: 'bar', night_club: 'bar', pub: 'bar', brewery: 'bar',
  wine_bar: 'bar', cocktail_bar: 'bar', sports_bar: 'bar',
  cafe: 'cafe', coffee_shop: 'cafe', bakery: 'cafe',
  clothing_store: 'shop', home_goods_store: 'shop', book_store: 'shop',
  shopping_mall: 'shop', store: 'shop',
  park: 'park', national_park: 'park', natural_feature: 'park',
  performing_arts_theater: 'theatre', theater: 'theatre', theatre: 'theatre',
  movie_theater: 'experience', cinema: 'experience',
  music_venue: 'music-venue', concert_hall: 'music-venue', jazz_club: 'music-venue',
  lodging: 'hotel', hotel: 'hotel', motel: 'hotel',
};

function betterType(name, currentType, googleTypes) {
  // Try Google types first
  if (googleTypes) {
    const types = Array.isArray(googleTypes) ? googleTypes : [googleTypes];
    for (const t of types) {
      const mapped = GOOGLE_TYPE_MAP[t.toLowerCase().replace(/ /g, '_')];
      if (mapped && VALID_TYPES.has(mapped)) return mapped;
    }
  }

  if (!name) return currentType;
  const n = name.toLowerCase();

  // Strong keyword matches
  if (/\bgallery\b|fine art|art space|art\+/.test(n)) return 'gallery';
  if (/museum|biennial|exhibition/.test(n)) return 'museum';
  if (/grocer|grocery|supermarket|market|food hall|provisions|organic/.test(n)) return 'grocery';
  if (/brewery|brewing|brew co|brewpub/.test(n)) return 'bar';
  if (/\bbar\b/.test(n) && !/bar menu|food bar|sushi bar/.test(n)) return 'bar';
  if (/wine bar|cocktail bar|distill/.test(n)) return 'bar';
  if (/cafe|café|coffee|bakery|boulangerie|patisserie/.test(n)) return 'cafe';
  if (/cinema|theatre|theater|comedy|improv/.test(n)) {
    if (/comedy|improv/.test(n)) return 'theatre';
    if (/cinema|movie/.test(n)) return 'experience';
    return 'theatre';
  }
  if (/music venue|jazz club|concert|the rex\b|nublu/.test(n)) return 'music-venue';
  if (/bookshop|bookstore|books\b/.test(n)) return 'shop';
  if (/boutique|design market|marketplace|clothing|accessories/.test(n)) return 'shop';
  if (/park|garden|preserve|nature/.test(n)) return 'park';

  return null; // no change
}

// ---- Fix card.json files ----
function fixCardJson() {
  let fixed = 0;
  const cardDir = CARDS_DIR;

  for (const placeId of readdirSync(cardDir)) {
    const p = join(cardDir, placeId, 'card.json');
    if (!existsSync(p)) continue;
    let card;
    try { card = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }

    const ident = card.identity || {};
    const name = ident.name || '';
    const current = ident.type || '';
    const google = ident.primaryType || ident.googleTypes || ident.types;

    const better = betterType(name, current, google);
    if (better && better !== current) {
      if (!DRY_RUN) {
        card.identity = { ...ident, type: better };
        writeFileSync(p, JSON.stringify(card, null, 2));
      }
      console.log(`  card.json: ${name} → ${current} → ${better}`);
      fixed++;
    }
  }
  return fixed;
}

// ---- Fix Blob discoveries ----
async function fixBlobDiscoveries(userId) {
  const blobPath = `users/${userId}/discoveries.json`;
  const { blobs } = await list({ prefix: blobPath, limit: 1 });
  const blob = blobs[0];
  if (!blob) { console.log(`  No discoveries.json for ${userId}`); return 0; }

  const res = await fetch(blob.url);
  if (!res.ok) { console.log(`  Failed to fetch: ${res.status}`); return 0; }
  const data = await res.json();
  const discoveries = Array.isArray(data) ? data : (data.discoveries || []);

  let fixed = 0;
  const updated = discoveries.map(d => {
    const name = d.name || '';
    const current = d.type || 'restaurant';
    const google = d.googleTypes || d.primaryType;
    const better = betterType(name, current, google);
    if (better && better !== current) {
      console.log(`  blob: ${name} → ${current} → ${better}`);
      fixed++;
      return { ...d, type: better };
    }
    return d;
  });

  if (fixed > 0 && !DRY_RUN) {
    // Re-write to Blob
    await del(blob.url);
    await put(blobPath, JSON.stringify({ discoveries: updated, updatedAt: new Date().toISOString() }, null, 2), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
  }
  return fixed;
}

async function main() {
  console.log(`\n🏷️  Type Fix — #77`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Fix card.json files
  console.log('--- card.json files ---');
  const cardFixed = fixCardJson();
  console.log(`  Fixed: ${cardFixed} card.json files\n`);

  // Fix Blob for each user
  const users = ['john', 'billy'];
  let blobFixed = 0;
  for (const userId of users) {
    console.log(`--- Blob: ${userId} ---`);
    blobFixed += await fixBlobDiscoveries(userId);
  }
  console.log(`\n  Blob fixed: ${blobFixed} discoveries\n`);

  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total: ${cardFixed} cards + ${blobFixed} blob discoveries fixed\n`);
}

main().catch(console.error);
