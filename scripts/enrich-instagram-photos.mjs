#!/usr/bin/env node
/* ============================================================
   #61 — Instagram Photo Scraping + AI Classification
   For flagship restaurants, scrapes Instagram for food/interior photos.
   Uses Claude Vision to classify and select the best images.
   Saves images to data/placecards/{place_id}/instagram/
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import https from 'https';
import http from 'http';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : 20;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCard(placeId) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function saveCard(placeId, card) {
  writeFileSync(join(CARDS_DIR, placeId, 'card.json'), JSON.stringify(card, null, 2));
}

/** Extract Instagram handle from website or identity */
async function findInstagramHandle(page, websiteUrl) {
  if (!websiteUrl) return null;

  // If the website IS Instagram
  const igMatch = websiteUrl.match(/instagram\.com\/([^/?]+)/);
  if (igMatch) return igMatch[1];

  try {
    await page.goto(websiteUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });
    // Look for Instagram links
    const igHandle = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="instagram.com"]'));
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/instagram\.com\/([^/?]+)/);
        if (m && m[1] && !['p', 'explore', 'accounts', 'tv'].includes(m[1])) {
          return m[1];
        }
      }
      return null;
    });
    return igHandle;
  } catch { return null; }
}

/** Scrape Instagram profile for recent post images */
async function scrapeInstagramImages(page, handle) {
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, {
      timeout: 15000,
      waitUntil: 'domcontentloaded',
    });

    // Wait for images to load
    await sleep(2000);

    // Extract image URLs from the grid
    const images = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[srcset], img[src]'));
      return imgs
        .map(img => {
          // Prefer srcset for higher res
          const srcset = img.getAttribute('srcset');
          if (srcset) {
            const parts = srcset.split(',').map(s => s.trim().split(' '));
            const largest = parts.reduce((a, b) => {
              const aW = parseInt(a[1]) || 0;
              const bW = parseInt(b[1]) || 0;
              return bW > aW ? b : a;
            });
            return largest[0];
          }
          return img.getAttribute('src');
        })
        .filter(src => src && src.includes('instagram') && src.includes('.jpg') && !src.includes('profile_pic'))
        .slice(0, 30);
    });

    return images.filter(Boolean);
  } catch { return []; }
}

/** Download an image to a local path */
async function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const file = createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

/** Use Claude Vision to classify an image */
async function classifyImage(imageUrl) {
  // Use URL-based vision (faster, no download needed for classification)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'url', url: imageUrl },
        }, {
          type: 'text',
          text: 'Classify this restaurant photo into exactly ONE word: food, drinks, interior, exterior, or skip (for people/unclear). Reply with only that one word.',
        }],
      }],
    }),
  });

  if (!res.ok) return 'skip';
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim().toLowerCase();
  const validCategories = ['food', 'drinks', 'interior', 'exterior'];
  return validCategories.includes(text) ? text : 'skip';
}

async function main() {
  console.log(`\n📸 Instagram Photo Scraping — #61`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Collect top cards with websites, sorted by rating
  const allCards = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    if (!['restaurant', 'bar', 'cafe'].includes(type)) continue;
    const website = card.identity?.website;
    if (!website) continue;
    const rating = parseFloat(card.identity?.rating || 0);
    allCards.push({ placeId, name: card.identity?.name || placeId, website, rating, card });
  }

  allCards.sort((a, b) => b.rating - a.rating);
  const targets = allCards.slice(0, LIMIT);

  console.log(`  Processing top ${targets.length} cards by rating\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    viewport: { width: 390, height: 844 },
  });

  let updatedCards = 0;
  let totalPhotos = 0;

  for (const { placeId, name, website, card } of targets) {
    process.stdout.write(`  ${name.slice(0, 40).padEnd(40)} `);

    const page = await context.newPage();

    try {
      // Step 1: Find Instagram handle
      const handle = await findInstagramHandle(page, website);
      if (!handle) {
        console.log('— no Instagram found');
        await page.close();
        await sleep(1000);
        continue;
      }

      process.stdout.write(`@${handle} `);

      // Step 2: Scrape Instagram images
      const imageUrls = await scrapeInstagramImages(page, handle);
      await page.close();

      if (imageUrls.length === 0) {
        console.log('— no images');
        await sleep(1000);
        continue;
      }

      // Step 3: Classify images with Claude Vision (first 12)
      const classified: Array<{ url: string; category: string }> = [];
      for (const url of imageUrls.slice(0, 12)) {
        try {
          const category = await classifyImage(url);
          if (category !== 'skip') {
            classified.push({ url, category });
          }
        } catch { /* skip */ }
        await sleep(300);
      }

      if (classified.length === 0) {
        console.log('— no classifiable images');
        await sleep(1000);
        continue;
      }

      // Step 4: Save best images per category
      const instagramDir = join(CARDS_DIR, placeId, 'instagram');
      if (!DRY_RUN) mkdirSync(instagramDir, { recursive: true });

      const saved: Array<{ path: string; category: string; source: string }> = [];
      const categoryCount: Record<string, number> = {};

      for (const { url, category } of classified) {
        const count = categoryCount[category] || 0;
        if (count >= 3) continue; // max 3 per category
        categoryCount[category] = count + 1;

        const filename = `${category}_${count + 1}.jpg`;
        const localPath = join(instagramDir, filename);

        if (!DRY_RUN) {
          try {
            await downloadImage(url, localPath);
            saved.push({
              path: `/placecards/${placeId}/instagram/${filename}`,
              category,
              source: 'instagram',
            });
          } catch { /* skip download failure */ }
        } else {
          saved.push({ path: `/placecards/${placeId}/instagram/${filename}`, category, source: 'instagram' });
        }
      }

      if (saved.length === 0) {
        console.log('— download failed');
        await sleep(1000);
        continue;
      }

      // Step 5: Update card.json with new images (prepend to existing)
      if (!DRY_RUN) {
        const existingImages = card.identity?.images || [];
        // Remove old instagram images if re-running
        const filtered = existingImages.filter(img => !img.source?.includes('instagram'));
        card.identity = card.identity || {};
        card.identity.instagram_handle = handle;
        card.identity.images = [...saved, ...filtered];
        saveCard(placeId, card);
      }

      console.log(`✅ ${saved.length} photos (${Object.entries(categoryCount).map(([k,v]) => `${v} ${k}`).join(', ')})`);
      updatedCards++;
      totalPhotos += saved.length;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 50)}`);
      try { await page.close(); } catch { /* ignore */ }
    }

    await sleep(2000);
  }

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Cards updated: ${updatedCards} | Total photos: ${totalPhotos}\n`);
}

main().catch(console.error);
