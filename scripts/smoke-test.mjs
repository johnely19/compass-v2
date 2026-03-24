#!/usr/bin/env node
/* ============================================================
   Compass V2 — Enhanced Smoke Test Suite
   Tests endpoints + content quality (sections, cards, images, data).
   Usage: node scripts/smoke-test.mjs [BASE_URL]
   Default: http://localhost:3002
   ============================================================ */

const BASE = process.argv[2] || 'http://localhost:3002';
const COOKIE = 'compass-user=john';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function fetchPage(url, opts = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { Cookie: COOKIE, ...opts.headers },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
    ...(opts.body ? { headers: { Cookie: COOKIE, 'Content-Type': 'application/json' } } : {}),
  });
  return res;
}

async function fetchHTML(url) {
  const res = await fetchPage(url);
  assert(res.status >= 200 && res.status < 400, `HTTP ${res.status}`);
  return await res.text();
}

async function fetchJSON(url) {
  const res = await fetchPage(url);
  if (res.status === 401 || res.status === 403) return { _auth: res.status };
  assert(res.status >= 200 && res.status < 400, `HTTP ${res.status}`);
  return await res.json();
}

async function run() {
  console.log(`\n🧭 Compass V2 Enhanced Smoke Tests`);
  console.log(`   Target: ${BASE}\n`);

  console.log('  — Page Routes —');

  // 1. Homepage
  await test('Homepage loads', async () => {
    const html = await fetchHTML('/');
    assert(!html.includes('data-next-error'), 'Page has React error');
  });

  // 2. Homepage has sections
  await test('Homepage has ≥5 context sections', async () => {
    const html = await fetchHTML('/');
    const sections = (html.match(/section-header/g) || []).length;
    assert(sections >= 5, `Only ${sections} sections (need ≥5)`);
  });

  // 3. Homepage has place cards
  await test('Homepage has ≥10 place cards', async () => {
    const html = await fetchHTML('/');
    const cards = (html.match(/place-card/g) || []).length;
    assert(cards >= 10, `Only ${cards} card refs (need ≥10)`);
  });

  // 4. Homepage has Blob image URLs
  await test('Homepage has ≥5 Blob image URLs', async () => {
    const html = await fetchHTML('/');
    const blobUrls = (html.match(/blob\.vercel-storage\.com/g) || []).length;
    assert(blobUrls >= 5, `Only ${blobUrls} Blob URLs (need ≥5)`);
  });

  // 5. No React errors
  await test('Homepage no React errors', async () => {
    const html = await fetchHTML('/');
    assert(!html.includes('data-next-error-message'), 'React error found');
  });

  // 6. Other pages
  await test('Places Browse loads', async () => { await fetchHTML('/placecards'); });
  await test('Review Hub loads', async () => { await fetchHTML('/review'); });
  await test('What\'s Hot loads', async () => { await fetchHTML('/hot'); });
  await test('Admin loads', async () => { await fetchHTML('/admin'); });
  await test('Join Page loads', async () => { await fetchHTML('/u/join'); });
  await test('Place Card Detail loads', async () => { await fetchHTML('/placecards/ChIJiQiJDZTN1IkRTgoWXTMVn1Q'); });

  console.log('\n  — API Routes —');

  // 7. Auth
  await test('Auth API returns user', async () => {
    const data = await fetchJSON('/api/auth');
    assert(data.user || data._auth, 'No user data');
  });

  // 8. Discoveries
  await test('Discoveries API returns array', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return; // auth required = alive
    assert(Array.isArray(data.discoveries), 'discoveries not an array');
    assert(data.discoveries.length > 0, 'discoveries empty');
  });

  // 9. Admin APIs with data checks
  await test('Admin Agents: non-zero agents', async () => {
    const data = await fetchJSON('/api/admin/agents');
    if (data._auth) return;
    assert(data.agents && data.agents.length > 0, 'No agents');
    assert(data.stats, 'No stats');
    assert(data.stats.placeCards > 0, 'placeCards is 0');
  });

  await test('Admin Crons: has jobs', async () => {
    const data = await fetchJSON('/api/admin/crons');
    if (data._auth) return;
    assert(data.jobs && data.jobs.length > 0, 'No cron jobs');
    // Check schedules are humanized
    const first = data.jobs[0];
    assert(!first.schedule.match(/^\*\/\d+ \*/), `Schedule still raw cron: ${first.schedule}`);
  });

  await test('Admin Tokens: has 24h data', async () => {
    const data = await fetchJSON('/api/admin/tokens');
    if (data._auth) return;
    assert(typeof data.total24h === 'number', 'No total24h');
  });

  // 10. Safety checks
  await test('Discovery POST rejects without auth', async () => {
    const res = await fetch(`${BASE}/api/user/discoveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discoveries: [] }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Briefing POST rejects without token', async () => {
    const res = await fetch(`${BASE}/api/briefing-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'test' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Summary
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${total} total`);

  if (failed > 0) {
    console.log(`\n  ⚠️  ${failed} test(s) failed\n`);
    process.exit(1);
  } else {
    console.log(`\n  🎉 All ${total} tests passed!\n`);
    process.exit(0);
  }
}

run();
