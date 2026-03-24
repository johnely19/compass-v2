#!/usr/bin/env node
/* ============================================================
   #60 — Reviews Enrichment: fetch Google reviews, curate with Claude,
   store as 'The Vibe' narrative block in card.json
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const TARGET_TYPES = new Set(['restaurant', 'bar', 'cafe']);
const RATE_LIMIT_MS = 300;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LIMIT = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY not set');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchReviews(placeId) {
  try {
    const out = execSync(`goplaces details ${placeId} --reviews --json`, {
      timeout: 12000,
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch { return null; }
}

async function selectBestReviews(placeName, reviews) {
  // Filter first: >100 chars, 4-5 stars
  const good = reviews.filter(r => {
    const text = r.text?.text || r.text || '';
    return typeof text === 'string' && text.length > 100 && (r.rating >= 4);
  });

  if (good.length === 0) return null;
  if (good.length <= 3) return good;

  // Use Claude to pick the 3 most quotable
  const reviewTexts = good.slice(0, 8).map((r, i) => {
    const text = r.text?.text || r.text || '';
    return `[${i+1}] ${r.rating}★ — "${text.slice(0, 400)}"`;
  }).join('\n\n');

  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `For the restaurant/bar "${placeName}", select the 3 most quotable Google reviews from this list.

Prefer reviews that: mention specific dishes or drinks by name, describe the experience vividly, feel authentic and specific.
Avoid: generic compliments ("great service!"), one-liners, reviews that only mention price.

Reviews:
${reviewTexts}

Reply with ONLY the indices of the 3 best reviews, comma-separated (e.g. "1,3,5"). Nothing else.`
    }],
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return good.slice(0, 3);
    const data = await res.json();
    const reply = data.content?.[0]?.text?.trim() || '';
    const indices = reply.split(',').map(s => parseInt(s.trim()) - 1).filter(n => !isNaN(n) && n >= 0 && n < good.length);
    if (indices.length >= 1) return indices.map(i => good[i]).filter(Boolean);
    return good.slice(0, 3);
  } catch {
    return good.slice(0, 3);
  }
}

function formatVibeBlock(reviews) {
  const stars = (n) => '⭐'.repeat(Math.min(n, 5));
  const lines = reviews.map(r => {
    const text = (r.text?.text || r.text || '').trim();
    const s = stars(r.rating);
    return `${s} "${text}"`;
  });
  return lines.join('\n\n');
}

function loadCard(placeId) {
  const p = join(CARDS_DIR, placeId, 'card.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function saveCard(placeId, card) {
  writeFileSync(join(CARDS_DIR, placeId, 'card.json'), JSON.stringify(card, null, 2));
}

async function main() {
  console.log(`\n💬 Reviews Enrichment — #60`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    if (!TARGET_TYPES.has(type)) continue;

    // Skip if already has vibe block (unless --force)
    const hasVibe = (card.narrative?.blocks || []).some(b => b.id === 'block-vibe');
    if (!FORCE && hasVibe) continue;

    targets.push({ placeId, name: card.identity?.name || placeId, card });
  }

  console.log(`  Found ${targets.length} cards\n`);

  let updated = 0;
  let noReviews = 0;
  let failed = 0;
  let count = 0;

  for (const { placeId, name, card } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${name.slice(0, 45).padEnd(45)} `);

    const details = fetchReviews(placeId);
    if (!details || !details.reviews || details.reviews.length === 0) {
      console.log('— no reviews');
      noReviews++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const selected = await selectBestReviews(name, details.reviews);
    if (!selected || selected.length === 0) {
      console.log('— no quality reviews');
      noReviews++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const vibeBody = formatVibeBlock(selected);
    const vibeBlock = {
      id: 'block-vibe',
      type: 'vibe',
      title: 'The Vibe',
      body: vibeBody,
    };

    // Add/replace vibe block in narrative.blocks
    if (!card.narrative) card.narrative = { summary: '', blocks: [] };
    if (!card.narrative.blocks) card.narrative.blocks = [];
    const existingIdx = card.narrative.blocks.findIndex(b => b.id === 'block-vibe');
    if (existingIdx >= 0) {
      card.narrative.blocks[existingIdx] = vibeBlock;
    } else {
      card.narrative.blocks.push(vibeBlock);
    }

    console.log(`✅ ${selected.length} reviews`);
    if (!DRY_RUN) saveCard(placeId, card);
    updated++;

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Updated: ${updated} | No reviews: ${noReviews} | Failed: ${failed}\n`);
}

main().catch(console.error);
