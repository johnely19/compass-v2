#!/usr/bin/env node
/* ============================================================
   #61 — Photo Classification via Claude Vision
   Instagram scraping blocked; instead classifies existing
   Google Places photos from manifest.json using Claude Vision.
   Adds category metadata to each image for better gallery rendering.
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

if (!API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }
if (!BLOB_BASE) { console.warn('Warning: NEXT_PUBLIC_BLOB_BASE_URL not set — using relative paths'); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadManifest(placeId) {
  const p = join(CARDS_DIR, placeId, 'manifest.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function saveManifest(placeId, manifest) {
  writeFileSync(join(CARDS_DIR, placeId, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function loadCard(placeId) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Classify up to 4 images at once with Claude Vision (multi-image) */
async function classifyImages(imageUrls) {
  const content = [];
  for (const url of imageUrls.slice(0, 4)) {
    content.push({ type: 'image', source: { type: 'url', url } });
  }
  content.push({
    type: 'text',
    text: `Classify each image in order. For each, reply with ONE word only from: food, drinks, interior, exterior, skip (for people/logos/menus).
Reply as comma-separated list exactly matching number of images. Example for 4 images: "food,interior,food,skip"`,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) return imageUrls.map(() => 'general');
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim().toLowerCase();
  const valid = ['food', 'drinks', 'interior', 'exterior', 'skip', 'general'];
  return text.split(',').map(t => {
    const c = t.trim();
    return valid.includes(c) ? c : 'general';
  });
}

function resolveUrl(path) {
  if (path.startsWith('http')) return path;
  if (path.startsWith('/') && BLOB_BASE) return `${BLOB_BASE}${path}`;
  return path;
}

async function main() {
  console.log(`\n📸 Photo Classification — #61`);
  console.log(`   (Claude Vision classifies existing Google Places photos)\n`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const manifest = loadManifest(placeId);
    if (!manifest?.images || manifest.images.length === 0) continue;

    const card = loadCard(placeId);
    const type = card?.identity?.type || '';
    if (!['restaurant', 'bar', 'cafe'].includes(type)) continue;

    // Check if images already classified
    const unclassified = manifest.images.filter(img => !img.classified);
    if (unclassified.length === 0) continue;

    targets.push({ placeId, name: card?.identity?.name || placeId, manifest, card });
  }

  console.log(`  Found ${targets.length} cards with unclassified photos\n`);

  let updated = 0;
  let totalClassified = 0;
  let count = 0;

  for (const { placeId, name, manifest } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${name.slice(0, 45).padEnd(45)} `);

    try {
      const images = manifest.images;
      const urls = images.map(img => resolveUrl(img.path));

      // Process in batches of 4
      const classified = [];
      for (let i = 0; i < urls.length; i += 4) {
        const batch = urls.slice(i, i + 4);
        const batchImages = images.slice(i, i + 4);
        try {
          const categories = await classifyImages(batch);
          for (let j = 0; j < batchImages.length; j++) {
            const img = batchImages[j];
            const cat = categories[j] || 'general';
            classified.push({
              ...img,
              category: cat === 'skip' ? (img.category || 'general') : cat,
              classified: true,
            });
          }
        } catch {
          classified.push(...batchImages.map(img => ({ ...img, classified: true })));
        }
        await sleep(300);
      }

      const counts = classified.reduce((acc, img) => {
        acc[img.category] = (acc[img.category] || 0) + 1;
        return acc;
      }, {});

      if (!DRY_RUN) {
        manifest.images = classified;
        saveManifest(placeId, manifest);
      }

      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
      console.log(`✅ ${classified.length} photos (${summary})`);
      updated++;
      totalClassified += classified.length;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 50)}`);
    }

    await sleep(500);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Cards updated: ${updated} | Photos classified: ${totalClassified}\n`);
}

main().catch(console.error);
