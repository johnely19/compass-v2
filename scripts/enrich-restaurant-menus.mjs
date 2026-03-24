#!/usr/bin/env node
/* ============================================================
   #59 — Menu Scraping via Playwright + Claude structuring
   Fetches real menu data from restaurant websites.
   Priority: cards with menu_link, then website.
   ============================================================ */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'data', 'placecards');
const TARGET_TYPES = new Set(['restaurant', 'bar', 'cafe']);
const RATE_LIMIT_MS = 1500;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
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

/** Find all menu-like links on a page */
async function findMenuUrl(page, baseUrl) {
  const menuPatterns = ['/menu', '/food', '/drinks', '/cocktails', '/wine-list', '#menu'];
  // Check current URL first if it's already a menu page
  const current = page.url();
  if (menuPatterns.some(p => current.toLowerCase().includes(p))) return current;

  // Look for menu links
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ href: a.getAttribute('href'), text: a.textContent?.toLowerCase().trim() }))
      .filter(l => l.href && (
        l.text?.includes('menu') ||
        l.text?.includes('food') ||
        l.text?.includes('drinks') ||
        (l.href || '').toLowerCase().includes('menu') ||
        (l.href || '').toLowerCase().includes('/food')
      ));
  });

  if (links.length === 0) return null;

  // Prefer direct /menu link
  const menuLink = links.find(l => (l.href || '').toLowerCase().includes('menu'));
  if (!menuLink?.href) return null;

  const href = menuLink.href;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) {
    const u = new URL(baseUrl);
    return u.origin + href;
  }
  return null;
}

/** Extract text content likely to be menu items */
async function extractMenuText(page) {
  return page.evaluate(() => {
    // Remove nav, footer, header, scripts, styles
    const remove = document.querySelectorAll('nav, footer, header, script, style, .cookie, .banner, .popup');
    remove.forEach(el => el.remove?.());

    // Get text with some structure
    const sections = [];
    const headings = document.querySelectorAll('h1, h2, h3, h4');

    if (headings.length > 2) {
      // Structured page — extract by heading
      headings.forEach(h => {
        const text = h.textContent?.trim();
        if (!text || text.length < 2) return;
        // Get following sibling content
        let sibling = h.nextElementSibling;
        const items = [];
        while (sibling && !['H1','H2','H3','H4'].includes(sibling.tagName)) {
          const t = sibling.textContent?.trim();
          if (t && t.length > 2 && t.length < 300) items.push(t);
          sibling = sibling.nextElementSibling;
        }
        if (items.length > 0) sections.push(`${text}\n${items.join('\n')}`);
      });
      if (sections.length > 1) return sections.join('\n\n');
    }

    // Fallback: get all text, filter for price-like lines
    const body = document.body.innerText || '';
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    // Keep lines with prices or that look like menu items
    const menuLines = lines.filter(l =>
      /\$\d+|\d+\.\d{2}|€\d+/.test(l) || // has price
      l.length < 80 // short lines (item names)
    );
    return menuLines.slice(0, 200).join('\n');
  });
}

/** Use Claude to structure raw menu text into JSON */
async function structureMenu(name, rawText) {
  if (!rawText || rawText.length < 50) return null;

  const prompt = `You are extracting a restaurant menu from scraped website text.

Restaurant: ${name}
Raw menu text (first 3000 chars):
${rawText.slice(0, 3000)}

Return ONLY valid JSON (no markdown) in this exact format:
{
  "sections": [
    {
      "name": "SECTION NAME",
      "items": [
        {"name": "Item Name", "price": "$XX", "description": "optional desc", "highlight": false}
      ]
    }
  ]
}

Rules:
- 2-6 sections max
- 3-8 items per section
- Mark 1-3 standout items as highlight:true
- Only real food/drink items, no gift cards or merchandise
- Include prices where visible (format: "$XX" or omit if unclear)
- Section names in ALL CAPS`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch { return null; }
}

/** Format menu JSON as readable text block */
function formatMenuBody(menu) {
  return menu.sections.map(section => {
    const items = section.items.map(item => {
      const star = item.highlight ? '⭐ ' : '• ';
      const price = item.price ? ` — ${item.price}` : '';
      const desc = item.description ? `\n   ${item.description}` : '';
      return `${star}${item.name}${price}${desc}`;
    }).join('\n');
    return `${section.name}\n${items}`;
  }).join('\n\n');
}

async function main() {
  console.log(`\n🍽️  Menu Scraping — #59`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Collect targets
  const targets = [];
  for (const placeId of readdirSync(CARDS_DIR)) {
    if (!placeId.startsWith('ChIJ')) continue;
    const card = loadCard(placeId);
    if (!card) continue;
    const type = card.identity?.type || '';
    if (!TARGET_TYPES.has(type)) continue;

    const hasMenu = (card.narrative?.blocks || []).some(b => b.type === 'menu');
    if (hasMenu) continue;

    const menuLink = card.identity?.menu_link || card.identity?.menu_url;
    const website = card.identity?.website;
    const url = menuLink || website;
    if (!url) continue;

    targets.push({
      placeId,
      name: card.identity?.name || placeId,
      url,
      isMenuLink: !!menuLink,
      card,
    });
  }

  // Priority: menu_link first
  targets.sort((a, b) => (b.isMenuLink ? 1 : 0) - (a.isMenuLink ? 1 : 0));
  console.log(`  Found ${targets.length} candidates (${targets.filter(t => t.isMenuLink).length} with menu_link)\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
    viewport: { width: 1280, height: 800 },
  });

  let updated = 0;
  let failed = 0;
  let noMenu = 0;
  let count = 0;

  for (const { placeId, name, url, card } of targets) {
    if (count >= LIMIT) break;
    count++;

    process.stdout.write(`  [${count}/${Math.min(targets.length, LIMIT)}] ${name.slice(0, 45).padEnd(45)} `);

    try {
      const page = await context.newPage();
      await page.goto(url, { timeout: 12000, waitUntil: 'domcontentloaded' });

      // Find menu URL if not already on it
      let menuUrl = url;
      const foundMenu = await findMenuUrl(page, url).catch(() => null);
      if (foundMenu && foundMenu !== page.url()) {
        await page.goto(foundMenu, { timeout: 10000, waitUntil: 'domcontentloaded' });
        menuUrl = foundMenu;
      }

      const rawText = await extractMenuText(page);
      await page.close();

      if (!rawText || rawText.length < 100) {
        console.log('— no menu text');
        noMenu++;
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const structured = await structureMenu(name, rawText);
      if (!structured || !structured.sections || structured.sections.length === 0) {
        console.log('— structured failed');
        noMenu++;
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const menuBlock = {
        id: 'block-menu',
        type: 'menu',
        title: 'The Menu',
        body: formatMenuBody(structured),
        sections: structured.sections,
      };

      if (!card.narrative) card.narrative = { summary: '', blocks: [] };
      if (!card.narrative.blocks) card.narrative.blocks = [];
      const existingIdx = card.narrative.blocks.findIndex(b => b.type === 'menu');
      if (existingIdx >= 0) card.narrative.blocks[existingIdx] = menuBlock;
      else card.narrative.blocks.push(menuBlock);

      const sectionCount = structured.sections.length;
      const itemCount = structured.sections.reduce((s, sec) => s + sec.items.length, 0);
      console.log(`✅ ${sectionCount} sections, ${itemCount} items`);

      if (!DRY_RUN) saveCard(placeId, card);
      updated++;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 50)}`);
      failed++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Updated: ${updated} | No menu found: ${noMenu} | Failed: ${failed}`);
  console.log(`  Total: ${count}/${targets.length}\n`);
}

main().catch(console.error);
