#!/usr/bin/env node
/**
 * qa-screenshot.mjs — Playwright screenshot engine for Compass QA
 *
 * Takes full-page screenshots of target pages, saves to qa/screenshots/latest/
 * Returns array of { name, path, url } for vision scoring.
 *
 * Usage:
 *   node scripts/qa-screenshot.mjs [BASE_URL]
 *   BASE_URL defaults to http://localhost:3002
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const LATEST_DIR = join(REPO, 'qa', 'screenshots', 'latest');
const BASE = process.argv[2] || 'http://localhost:3002';
const COOKIE_NAME = 'compass-user';
const COOKIE_VALUE = 'john';
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 Pro

mkdirSync(LATEST_DIR, { recursive: true });

/** Target pages for every QA run */
const SCREENSHOT_TARGETS = [
  // Homepage sections
  { url: '/', name: 'home-full', fullPage: true },
  // NYC trip place cards
  { url: '/placecards/ChIJZ-_BPZRZwokRBp_dcoCezqQ?context=trip:nyc-april-2026', name: 'placecard-restaurant-cookshop' },
  { url: '/placecards/ChIJ6-9kbQBZwokR7RTDKFGG5Zc?context=trip:nyc-april-2026', name: 'placecard-bar-balera' },
  { url: '/placecards/ChIJh_9WxK40K4gRXIZXK5Oc7B4?context=outing:date-night-with-huzur', name: 'placecard-restaurant-portici' },
  { url: '/placecards/ChIJiQiJDZTN1IkRTgoWXTMVn1Q?context=radar:toronto-experiences', name: 'placecard-cafe-etape22' },
  // Accommodation
  { url: '/placecards/ChIJD3H7Bi5yKk0R0BFMOnrqMSA?context=trip:cottage-july-2026', name: 'placecard-cottage-muskoka' },
  // Review pages
  { url: '/review/trip%3Anyc-april-2026', name: 'review-nyc' },
  { url: '/review/radar%3Atoronto-experiences', name: 'review-toronto' },
  // Browse + hot
  { url: '/placecards', name: 'browse-places' },
  { url: '/hot', name: 'hot-page' },
];

/**
 * Take screenshots of all targets.
 * @param {string} baseUrl
 * @param {Object} opts
 * @param {string[]} opts.only - only screenshot these names
 * @returns {Promise<Array<{name: string, path: string, url: string, error?: string}>>}
 */
export async function takeScreenshots(baseUrl = BASE, opts = {}) {
  const results = [];
  const targets = opts.only
    ? SCREENSHOT_TARGETS.filter(t => opts.only.includes(t.name))
    : SCREENSHOT_TARGETS;

  console.log(`  📸 Launching Chromium (${VIEWPORT.width}×${VIEWPORT.height} — iPhone viewport)...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  // Set auth cookie for john
  await context.addCookies([{
    name: COOKIE_NAME,
    value: COOKIE_VALUE,
    domain: new URL(baseUrl).hostname,
    path: '/',
  }]);

  for (const target of targets) {
    const url = `${baseUrl}${target.url}`;
    const outPath = join(LATEST_DIR, `${target.name}.png`);

    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

      // Wait for images to load
      await page.waitForTimeout(1500);

      // Scroll to trigger lazy loading if full page
      if (target.fullPage) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
      }

      await page.screenshot({
        path: outPath,
        fullPage: target.fullPage ?? false,
        type: 'png',
      });

      console.log(`  ✅ ${target.name}`);
      results.push({ name: target.name, path: outPath, url });
      await page.close();
    } catch (err) {
      console.log(`  ❌ ${target.name}: ${err.message}`);
      results.push({ name: target.name, path: outPath, url, error: err.message });
    }
  }

  await browser.close();
  return results;
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`\n📸 Compass QA Screenshot Engine`);
  console.log(`   Target: ${BASE}\n`);

  takeScreenshots(BASE)
    .then(results => {
      const ok = results.filter(r => !r.error).length;
      const err = results.filter(r => r.error).length;
      console.log(`\n  Results: ${ok} captured, ${err} failed`);
      console.log(`  Saved to: qa/screenshots/latest/\n`);
    })
    .catch(err => {
      console.error(`Fatal: ${err.message}`);
      process.exit(1);
    });
}
