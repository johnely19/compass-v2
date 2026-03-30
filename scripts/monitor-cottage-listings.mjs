#!/usr/bin/env node
/**
 * monitor-cottage-listings.mjs
 *
 * Monitors shortlisted Disco cottage listings for trip:cottage-july-2026.
 * Checks 6 listings every 6 hours for:
 *   - Availability (is listing still active?)
 *   - Price changes (price dropped below $2,500/week)
 *   - July availability changes
 *   - Listing going offline
 *
 * State stored in: data/cottage-snapshots.jsonl
 * Alerts via: openclaw message send (Telegram)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_PATH = path.join(REPO_ROOT, 'data', 'cottage-snapshots.jsonl');

// Alert config
const TELEGRAM_TARGET = '1422716904';
const DISCORD_TARGET = '1476327134720036934';
const PRICE_ALERT_THRESHOLD = 2500; // alert when price drops below this per week

// The 6 shortlisted Disco cottage listings for trip:cottage-july-2026
const LISTINGS = [
  {
    id: 'highlands-east',
    name: 'Highlands East',
    source: 'disco-search-kijiji',
    url: 'https://www.kijiji.ca/v-cottage-rental/kawartha-lakes/highlands-east-cottage/k0c800l1700185',
    platform: 'kijiji',
    notes: 'Highlands East area cottage',
    targetMonth: 'July 2026',
  },
  {
    id: 'moira-lake',
    name: 'Moira Lake',
    source: 'disco-search-cottagesincanada',
    url: 'https://www.cottagesincanada.com/29388',
    platform: 'cottagesincanada',
    notes: 'Moira Lake, cottagesincanada listing #29388',
    targetMonth: 'July 2026',
  },
  {
    id: 'devil-lake-east',
    name: 'Devil Lake East',
    source: 'disco-search-kijiji',
    url: 'https://www.kijiji.ca/v-cottage-rental/ontario/devil-lake-east-cottage/k0c800l9004',
    platform: 'kijiji',
    notes: 'Devil Lake East area cottage',
    targetMonth: 'July 2026',
  },
  {
    id: 'garrison-lake',
    name: 'Garrison Lake',
    source: 'disco-search-cottagesincanada',
    url: 'https://www.cottagesincanada.com/33733',
    platform: 'cottagesincanada',
    notes: 'Garrison Lake, cottagesincanada listing #33733',
    targetMonth: 'July 2026',
  },
  {
    id: 'haliburton-vrbo',
    name: 'Haliburton VRBO',
    source: 'disco-search-vrbo',
    url: 'https://www.vrbo.com/en-ca/p7417233',
    platform: 'vrbo',
    notes: 'Haliburton VRBO listing #7417233',
    targetMonth: 'July 2026',
  },
  {
    id: 'paradise-cove',
    name: 'Paradise Cove',
    source: 'disco-search-cottagesincanada',
    url: 'https://www.cottagesincanada.com/36457',
    platform: 'cottagesincanada',
    notes: 'Paradise Cove, cottagesincanada listing #36457',
    targetMonth: 'July 2026',
  },
];

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Price patterns — look for weekly rates in CAD
const PRICE_PATTERNS = [
  /(?:\$|CAD\s?\$?|CA\$)\s*([\d,]+)\s*(?:\/\s*(?:week|wk|night|nightly))?/gi,
  /([\d,]+)\s*(?:cad|canadian\s+dollars?)\s*(?:\/\s*(?:week|wk))?/gi,
  /(?:weekly?|per\s+week)\s*(?:rate|price|rental)?:?\s*(?:\$|CAD)?\s*([\d,]+)/gi,
];

// July availability patterns
const JULY_AVAILABLE_PATTERNS = [
  /july\s+(?:\d{1,2}[-–]\d{1,2}|2026)?\s*(?:available|open|free)/i,
  /available.*july/i,
  /july.*available/i,
  /july.*(?:dates?|weeks?|open)/i,
];

const JULY_BOOKED_PATTERNS = [
  /july\s+(?:\d{1,2}[-–]\d{1,2}|2026)?\s*(?:booked|unavailable|taken|sold)/i,
  /july.*(?:booked|unavailable|not\s+available)/i,
  /booked.*july/i,
  /unavailable.*july/i,
];

// Offline/blocked patterns
const OFFLINE_PATTERNS = [
  /listing\s+(?:has\s+been\s+)?(?:removed|deleted|expired)/i,
  /(?:this\s+)?(?:ad|listing|property)\s+(?:is\s+)?no\s+longer\s+available/i,
  /page\s+not\s+found/i,
  /404/i,
  /access\s+denied/i,
  /captcha/i,
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashContent(text) {
  return crypto.createHash('sha1').update(text.slice(0, 20000)).digest('hex').slice(0, 12);
}

function normalizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPrices(text) {
  const values = [];
  for (const regex of PRICE_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const raw = String(m[1] || m[2] || '').replace(/,/g, '');
      const n = Number(raw);
      // Weekly rates for cottages: filter out per-night rates (< 200) and absurdly high values
      if (Number.isFinite(n) && n >= 500 && n <= 50000) {
        values.push(n);
      }
      if (values.length >= 12) break;
    }
  }
  if (!values.length) return { priceLow: null, priceHigh: null, priceText: null };
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return {
    priceLow: sorted[0],
    priceHigh: sorted[sorted.length - 1],
    priceText: sorted.length === 1 ? `$${sorted[0]}` : `$${sorted[0]}–$${sorted[sorted.length - 1]}`,
  };
}

function detectJulyAvailability(text) {
  const available = JULY_AVAILABLE_PATTERNS.some(p => p.test(text));
  const booked = JULY_BOOKED_PATTERNS.some(p => p.test(text));
  if (available && !booked) return 'available';
  if (booked && !available) return 'booked';
  if (available && booked) return 'mixed';
  return 'unknown';
}

function detectOffline(text, status) {
  if (status === 404 || status === 410) return true;
  if (status === 403 || status === 429) return false; // blocked, not offline
  return OFFLINE_PATTERNS.some(p => p.test(text));
}

async function fetchListing(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'en-CA,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function loadSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_PATH)) return [];
  return fs.readFileSync(SNAPSHOTS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function getLastSnapshot(id) {
  const all = loadSnapshots();
  const forId = all.filter(s => s.id === id);
  if (!forId.length) return null;
  return forId.sort((a, b) => b.checkedAt - a.checkedAt)[0];
}

function appendSnapshot(snapshot) {
  fs.mkdirSync(path.dirname(SNAPSHOTS_PATH), { recursive: true });
  fs.appendFileSync(SNAPSHOTS_PATH, JSON.stringify(snapshot) + '\n');
}

function sendAlert(message) {
  console.log('\n🚨 ALERT:', message);
  // Send via Telegram
  try {
    execSync(
      `openclaw message send --channel telegram --target "${TELEGRAM_TARGET}" --message "${message.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      { stdio: 'pipe', timeout: 15000 }
    );
    console.log('✅ Alert sent via Telegram');
  } catch (err) {
    console.warn('⚠️ Telegram alert failed:', err.message);
    // Fallback to Discord
    try {
      execSync(
        `openclaw message send --channel discord --target "${DISCORD_TARGET}" --message "${message.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
        { stdio: 'pipe', timeout: 15000 }
      );
      console.log('✅ Alert sent via Discord (fallback)');
    } catch (err2) {
      console.warn('⚠️ Discord fallback also failed:', err2.message);
    }
  }
}

async function checkListing(listing) {
  const { id, name, url, platform } = listing;
  console.log(`\n🔍 Checking ${name} (${platform})...`);

  const result = await fetchListing(url);
  const text = normalizeHtml(result.html || '');
  const nowMs = Date.now();

  const { priceLow, priceHigh, priceText } = extractPrices(text);
  const julyStatus = detectJulyAvailability(text);
  const isOffline = detectOffline(text, result.status);
  const bodyHash = hashContent(text);

  const snapshot = {
    id,
    name,
    url,
    platform,
    checkedAt: nowMs,
    checkedAtISO: new Date(nowMs).toISOString(),
    fetch: {
      ok: result.ok,
      status: result.status,
      finalUrl: result.finalUrl,
      bodyHash,
      error: result.error || null,
    },
    extracted: {
      priceLow,
      priceHigh,
      priceText,
      julyStatus,
      isOffline,
    },
  };

  // Load previous snapshot for comparison
  const prev = getLastSnapshot(id);

  const alerts = [];

  // === Alert: listing went offline ===
  if (isOffline && (!prev || !prev.extracted?.isOffline)) {
    alerts.push({
      type: 'offline',
      message: `🏚️ Cottage listing went OFFLINE: ${name}\n${url}`,
    });
  }

  if (prev && prev.extracted?.isOffline && !isOffline) {
    alerts.push({
      type: 'back_online',
      message: `✅ Cottage listing is back ONLINE: ${name}\n${url}`,
    });
  }

  // === Alert: price drop below threshold ===
  if (priceLow !== null) {
    const prevPrice = prev?.extracted?.priceLow ?? null;
    if (priceLow < PRICE_ALERT_THRESHOLD) {
      if (prevPrice === null || prevPrice >= PRICE_ALERT_THRESHOLD) {
        alerts.push({
          type: 'price_dropped_below_threshold',
          message: `💰 Price alert! ${name} is now ${priceText}/week (below $${PRICE_ALERT_THRESHOLD.toLocaleString()} threshold)\n${url}`,
        });
      }
    }

    // General price change notification
    if (prevPrice !== null && prevPrice !== priceLow) {
      const delta = priceLow - prevPrice;
      const arrow = delta < 0 ? '📉' : '📈';
      const sign = delta > 0 ? '+' : '';
      console.log(`  ${arrow} Price changed: $${prevPrice} → $${priceLow} (${sign}${delta})`);
    }
  }

  // === Alert: July availability opened up ===
  if (julyStatus === 'available' || julyStatus === 'mixed') {
    const prevJuly = prev?.extracted?.julyStatus;
    if (prevJuly && prevJuly !== 'available' && prevJuly !== 'mixed' && prevJuly !== 'unknown') {
      alerts.push({
        type: 'july_opened',
        message: `📅 July dates may have OPENED UP at ${name}!\nJuly status: ${julyStatus}\n${url}`,
      });
    }
  }

  // Log snapshot state
  const statusIcon = isOffline ? '🔴' : result.ok ? '✅' : '⚠️';
  console.log(`  ${statusIcon} Status: HTTP ${result.status} | ${isOffline ? 'OFFLINE' : 'Active'}`);
  if (priceText) console.log(`  💰 Price: ${priceText}/week`);
  console.log(`  📅 July: ${julyStatus}`);
  console.log(`  🔑 Hash: ${bodyHash}`);

  // Save snapshot (after comparison but before sending alerts to avoid re-alerting on same run)
  appendSnapshot(snapshot);

  return { listing, snapshot, prev, alerts };
}

async function main() {
  console.log('🏡 Cottage Listing Monitor — trip:cottage-july-2026');
  console.log(`📋 Checking ${LISTINGS.length} shortlisted listings...`);
  console.log(`⏰ ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })} ET\n`);

  const results = [];

  for (let i = 0; i < LISTINGS.length; i++) {
    const listing = LISTINGS[i];
    const result = await checkListing(listing);
    results.push(result);
    // Pace between requests
    if (i < LISTINGS.length - 1) {
      await sleep(1500);
    }
  }

  // Collect and fire all alerts
  const allAlerts = results.flatMap(r => r.alerts);

  if (allAlerts.length > 0) {
    console.log(`\n🚨 ${allAlerts.length} alert(s) detected:`);
    for (const alert of allAlerts) {
      sendAlert(alert.message);
      await sleep(500);
    }
  } else {
    console.log('\n✅ No alerts — all listings stable.');
  }

  // Summary
  console.log('\n--- Summary ---');
  for (const { listing, snapshot } of results) {
    const { isOffline, priceText, julyStatus } = snapshot.extracted;
    const status = isOffline ? '🔴 Offline' : snapshot.fetch.ok ? '✅ Active' : `⚠️ HTTP ${snapshot.fetch.status}`;
    const price = priceText ? `${priceText}/wk` : 'price unknown';
    console.log(`  ${listing.name}: ${status} | ${price} | July: ${julyStatus}`);
  }

  console.log(`\n📦 Snapshots saved to: ${SNAPSHOTS_PATH}`);
  console.log(`📊 Total snapshots on file: ${loadSnapshots().length}`);
}

main().catch(err => {
  console.error('❌ monitor-cottage-listings failed:', err);
  process.exit(1);
});
