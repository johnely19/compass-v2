#!/usr/bin/env node
/* ============================================================
   #65 — Thin card enrichment
   Finds restaurant/bar/cafe cards with no prose narrative blocks.
   Uses Claude + web search to write Space, Food, Vibe, Check sections.
   Quality: evocative 2nd-person food writing. NOT generic AI prose.
   Rate limit: 5s per card.
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const TARGET_TYPES = new Set(['restaurant', 'bar', 'cafe']);
const RATE_LIMIT_MS = 5000;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LIMIT = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
const BATCH = process.argv.includes('--batch') ? parseInt(process.argv[process.argv.indexOf('--batch') + 1]) : 20;
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

function isThin(card) {
  if (FORCE) return true;
  const blocks = card.narrative?.blocks || [];
  const proseBlocks = blocks.filter(b =>
    b.type !== 'vibe' && b.type !== 'menu' &&
    b.body && typeof b.body === 'string' && b.body.length > 100
  );
  return proseBlocks.length === 0;
}

async function enrichCard(name, address, city, website, summary, existingVibeBody) {
  const vibeContext = existingVibeBody
    ? `\n\nGuest reviews already collected:\n${existingVibeBody.slice(0, 800)}`
    : '';

  const prompt = `You are writing place card content for a luxury travel app. The writing should feel like a real food editor — specific, physical, 2nd-person, evocative. No corporate language. No "This charming restaurant...". Start with where it is, what you see, what makes it worth going.

Restaurant: ${name}
Address: ${address}, ${city}
Website: ${website || 'not available'}
Known facts: ${summary || 'minimal info'}${vibeContext}

Write the following 3 sections. Be specific about the physical space, real menu items where known, and honest about the vibe. Make each section feel distinct.

Return ONLY valid JSON, no markdown:
{
  "blocks": [
    {
      "type": "prose",
      "title": "The Space",
      "body": "2-3 sentences, 2nd person. Start with the neighbourhood/block. Describe what you see walking in — materials, light, layout, how it feels. Be specific: 'pressed-tin ceilings', 'a long marble bar', 'six tables tucked against exposed brick'. No 'cozy' or 'charming' without a physical detail."
    },
    {
      "type": "prose", 
      "title": "The Food",
      "body": "3-4 sentences. What defines the cooking here? Mention 2-3 specific dishes or ingredients. If it's Italian, which region? If it's ramen, which style? Mention price range naturally ('mains around $20-28'). Use the summary facts and any website info."
    },
    {
      "type": "prose",
      "title": "Go When",
      "body": "1-2 sentences on the best occasion. Be specific: 'a slow Tuesday lunch', 'date night when you want somewhere that doesn't try too hard', 'a solo dinner at the bar'. Not generic 'great for any occasion'."
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
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log(`\n✍️  Thin Card Enrichment — #65`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Collect targets
  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    if (!TARGET_TYPES.has(type)) continue;
    if (!isThin(card)) continue;

    targets.push({
      placeId,
      name: card.identity?.name || placeId,
      type,
      rating: card.identity?.rating || 0,
      card,
    });
  }

  // Sort: highest rating first (best cards get enriched first)
  targets.sort((a, b) => b.rating - a.rating);

  const totalToProcess = Math.min(targets.length, LIMIT);
  console.log(`  Found ${targets.length} thin cards → processing ${totalToProcess}\n`);

  let updated = 0;
  let failed = 0;
  let count = 0;

  for (const { placeId, name, card } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${totalToProcess}] ${name.slice(0, 50).padEnd(50)} `);

    const identity = card.identity || {};
    const existingVibe = (card.narrative?.blocks || []).find(b => b.id === 'block-vibe')?.body;

    try {
      const result = await enrichCard(
        name,
        identity.address || '',
        identity.city || '',
        identity.website || '',
        card.narrative?.summary || '',
        existingVibe,
      );

      if (!result?.blocks || result.blocks.length === 0) {
        throw new Error('Empty blocks returned');
      }

      // Assign IDs and merge with existing blocks (keep vibe, menu if present)
      const newBlocks = result.blocks.map((b, i) => ({
        ...b,
        id: `block-${b.title.toLowerCase().replace(/\s+/g, '-')}-${i}`,
      }));

      if (!card.narrative) card.narrative = { summary: '', blocks: [] };
      if (!card.narrative.blocks) card.narrative.blocks = [];

      // Keep existing vibe and menu blocks, add new prose blocks
      const keep = card.narrative.blocks.filter(b => b.type === 'vibe' || b.type === 'menu');
      card.narrative.blocks = [...newBlocks, ...keep];

      console.log(`✅ ${result.blocks.length} blocks`);
      if (!DRY_RUN) saveCard(placeId, card);
      updated++;

      // Batch pause every BATCH cards
      if (count % BATCH === 0) {
        console.log(`\n  ⏸️  Batch ${Math.floor(count / BATCH)} complete — pausing 10s...\n`);
        await sleep(10000);
      } else {
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 60)}`);
      failed++;
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Updated: ${updated} | Failed: ${failed} | Remaining thin: ${targets.length - updated}`);
  console.log(`\n✅ Wave 3 enrichment complete\n`);
}

main().catch(console.error);
