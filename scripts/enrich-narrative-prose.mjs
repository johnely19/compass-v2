#!/usr/bin/env node
/* ============================================================
   #62 — Infatuation + Eater narrative scraping
   For NYC + Toronto restaurant cards, search for professional
   reviews on The Infatuation and Eater, then use Claude to
   distill into evocative Space/Food prose blocks.
   Falls back to direct Claude enrichment if no review found.
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const TARGET_TYPES = new Set(['restaurant', 'bar', 'cafe']);
const TARGET_CITIES = ['toronto', 'new york', 'brooklyn', 'manhattan', 'nyc'];
const RATE_LIMIT_MS = 2000;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
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

function needsSpaceBlock(card) {
  const blocks = card.narrative?.blocks || [];
  return !blocks.some(b =>
    b.title?.toLowerCase().includes('space') ||
    (b.type === 'prose' && b.title?.toLowerCase().includes('space'))
  );
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function scrapeUrl(page, url, selectors) {
  try {
    await page.goto(url, { timeout: 12000, waitUntil: 'domcontentloaded' });
    for (const sel of selectors) {
      try {
        const text = await page.$eval(sel, el => el.textContent?.trim());
        if (text && text.length > 100) return text;
      } catch { /* try next */ }
    }
    // Fallback: get main content
    return await page.evaluate(() => {
      const main = document.querySelector('main, article, [class*="review"], [class*="content"]');
      return main?.textContent?.trim()?.slice(0, 3000) || '';
    });
  } catch { return ''; }
}

async function tryInfatuation(page, name, city) {
  const slug = slugify(name);
  const citySlug = city.includes('toronto') ? 'toronto' : 'new-york';
  const url = `https://www.theinfatuation.com/${citySlug}/reviews/${slug}`;
  const text = await scrapeUrl(page, url, [
    '[class*="review-body"]',
    '[class*="ReviewBody"]',
    '[class*="article-body"]',
    'article p',
  ]);
  if (text && text.length > 200 && !text.includes('Page Not Found') && !text.includes('404')) {
    return { source: 'The Infatuation', text: text.slice(0, 2000) };
  }
  return null;
}

async function tryEater(page, name, city) {
  const citySlug = city.includes('toronto') ? 'toronto' : 'maps/best-restaurants-new-york';
  const searchUrl = `https://www.eater.com/${citySlug}`;
  // Eater is map-based, search for the restaurant name
  try {
    await page.goto(searchUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });
    const text = await page.evaluate((n) => {
      const items = document.querySelectorAll('[class*="mapstack"], [class*="entry"], .c-mapstack__info');
      for (const item of items) {
        if (item.textContent?.toLowerCase().includes(n.toLowerCase().slice(0, 10))) {
          return item.textContent?.trim().slice(0, 1000);
        }
      }
      return '';
    }, name);
    if (text && text.length > 100) return { source: 'Eater', text };
  } catch { /* skip */ }
  return null;
}

async function synthesizeWithClaude(name, address, city, summary, externalReview, existingVibe) {
  const reviewContext = externalReview
    ? `\n\nProfessional review from ${externalReview.source}:\n${externalReview.text}`
    : '';
  const vibeContext = existingVibe
    ? `\n\nGuest reviews:\n${existingVibe.slice(0, 600)}`
    : '';

  const prompt = `You are writing place card content for a luxury travel app. Write in the voice of a knowing food editor — specific, physical, 2nd-person, no corporate language.

Restaurant: ${name}
Address: ${address}, ${city}
Summary: ${summary || 'minimal info'}${reviewContext}${vibeContext}

Write these 2 sections. Be specific about physical space and food. No "This charming..." or "nestled in...".

Return ONLY valid JSON:
{
  "blocks": [
    {
      "type": "prose",
      "title": "The Space",
      "body": "2-3 sentences, 2nd person. What do you see walking in? Specific materials, light, layout. One memorable physical detail. Start with the street/neighbourhood."
    },
    {
      "type": "prose",
      "title": "The Food",
      "body": "2-3 sentences. What defines the cooking? 2 specific dishes or ingredients. Price range naturally embedded."
    }
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log(`\n📰 Narrative Prose Enrichment — #62`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Find targets: NYC/Toronto restaurant cards missing Space block
  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    const city = (card.identity?.city || '').toLowerCase();
    if (!TARGET_TYPES.has(type)) continue;
    if (!TARGET_CITIES.some(c => city.includes(c))) continue;
    if (!needsSpaceBlock(card)) continue;
    targets.push({
      placeId, name: card.identity?.name || placeId,
      address: card.identity?.address || '',
      city: card.identity?.city || '',
      rating: card.identity?.rating || 0,
      card,
    });
  }

  targets.sort((a, b) => b.rating - a.rating);
  console.log(`  Found ${targets.length} cards missing Space block\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
  });

  let updated = 0;
  let fromReviews = 0;
  let failed = 0;
  let count = 0;

  for (const { placeId, name, address, city, card } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${name.slice(0, 45).padEnd(45)} `);

    try {
      const page = await context.newPage();

      // Try Infatuation first, then Eater
      let externalReview = null;
      externalReview = await tryInfatuation(page, name, city.toLowerCase());
      if (!externalReview) {
        externalReview = await tryEater(page, name, city.toLowerCase());
      }
      await page.close();

      const existingVibe = (card.narrative?.blocks || []).find(b => b.id === 'block-vibe')?.body;
      const result = await synthesizeWithClaude(
        name, address, city,
        card.narrative?.summary || '',
        externalReview,
        existingVibe,
      );

      if (!result?.blocks?.length) throw new Error('No blocks returned');

      const newBlocks = result.blocks.map((b, i) => ({
        ...b,
        id: `block-${b.title.toLowerCase().replace(/\s+/g, '-')}-${i}`,
      }));

      // Prepend new blocks, keeping existing (vibe, menu, go-when, etc.)
      if (!card.narrative) card.narrative = { summary: '', blocks: [] };
      const existingKeep = (card.narrative.blocks || []).filter(b =>
        b.type !== 'prose' || !['the space', 'the food'].includes(b.title?.toLowerCase() || '')
      );
      card.narrative.blocks = [...newBlocks, ...existingKeep];

      const src = externalReview ? ` (from ${externalReview.source})` : '';
      console.log(`✅ ${result.blocks.length} blocks${src}`);
      if (!DRY_RUN) saveCard(placeId, card);
      updated++;
      if (externalReview) fromReviews++;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 50)}`);
      failed++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Updated: ${updated} (${fromReviews} used pro review sources) | Failed: ${failed}\n`);
}

main().catch(console.error);
