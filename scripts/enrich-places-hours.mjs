#!/usr/bin/env node
/* ============================================================
   #58 — Places Enrichment: hours, rating, reviews, price, phone, website
   Reads all restaurant/bar/cafe/grocery/shop cards with ChIJ place_ids.
   Calls `goplaces details {place_id} --json` for each.
   Updates card.json identity fields. Idempotent.
   Rate limit: 200ms between calls.
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const TARGET_TYPES = new Set(['restaurant', 'bar', 'cafe', 'grocery', 'shop']);
const RATE_LIMIT_MS = 200;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force'); // re-fetch even if hours exist
const LIMIT = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchPlaceDetails(placeId) {
  try {
    const out = execSync(`goplaces details ${placeId} --json`, {
      timeout: 10000,
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function loadCard(placeId) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

function saveCard(placeId, card) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  writeFileSync(p, JSON.stringify(card, null, 2));
}

async function main() {
  console.log(`\n🗺️  Places Enrichment — #58`);
  if (DRY_RUN) console.log('   DRY RUN — no writes\n');
  if (FORCE) console.log('   FORCE — re-fetching even if hours exist\n');

  // Collect target cards
  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    if (!TARGET_TYPES.has(type)) continue;

    // Skip if already has hours (unless --force)
    if (!FORCE && card.identity?.hours?.length > 0) continue;

    targets.push({ placeId, name: card.identity?.name || placeId, type, card });
  }

  console.log(`  Found ${targets.length} cards to enrich\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let count = 0;

  for (const { placeId, name, card } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${placeId.slice(0, 12)} ${name.slice(0, 40).padEnd(40)} `);

    const details = fetchPlaceDetails(placeId);
    if (!details) {
      console.log('❌ fetch failed');
      failed++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const fields = [];
    const identity = card.identity || {};

    // Hours
    if (details.hours && Array.isArray(details.hours) && details.hours.length > 0) {
      if (!identity.hours || identity.hours.length === 0 || FORCE) {
        identity.hours = details.hours;
        fields.push('hours');
      }
    }

    // Rating
    if (details.rating && !identity.rating) {
      identity.rating = details.rating;
      fields.push('rating');
    }

    // Review count
    if (details.user_rating_count && !identity.review_count) {
      identity.review_count = details.user_rating_count;
      fields.push('reviews');
    }

    // Price level
    if (details.price_level != null && !identity.price_level) {
      identity.price_level = details.price_level;
      fields.push('price');
    }

    // Phone
    if (details.phone && !identity.phone) {
      identity.phone = details.phone;
      fields.push('phone');
    }

    // Website
    if (details.website && !identity.website) {
      identity.website = details.website;
      fields.push('website');
    }

    if (fields.length > 0) {
      console.log(`✅ ${fields.join(' ')}`);
      if (!DRY_RUN) {
        card.identity = identity;
        saveCard(placeId, card);
      }
      updated++;
    } else {
      console.log('— no new fields');
      skipped++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`  Total processed: ${count}/${targets.length}\n`);
}

main().catch(console.error);
