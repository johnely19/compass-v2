#!/usr/bin/env node
/* ============================================================
   Compass V2 — Smoke Test Suite (Layer 1)
   Tests: routes, APIs, content quality, image URLs, city labels,
          map embeds, triage end-to-end.
   Usage: node scripts/smoke-test.mjs [BASE_URL]
   Default: http://localhost:3002
   ============================================================ */

const BASE = process.argv[2] || 'http://localhost:3002';
const COOKIE = 'compass-user=john';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function fetchPage(url, opts = {}) {
  const headers = { Cookie: COOKIE };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(`${BASE}${url}`, {
    headers,
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  return res;
}

async function fetchHTML(url) {
  const res = await fetchPage(url);
  assert(res.status >= 200 && res.status < 400, `HTTP ${res.status}`);
  return await res.text();
}

async function fetchJSON(url, opts = {}) {
  const res = await fetchPage(url, opts);
  if (res.status === 401 || res.status === 403) return { _auth: res.status };
  assert(res.status >= 200 && res.status < 400, `HTTP ${res.status}`);
  return await res.json();
}

// Check that a URL returns 200
async function checkUrl(url, label) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    assert(res.ok, `${label}: HTTP ${res.status}`);
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
}

async function run() {
  console.log(`\n🧭 Compass V2 Smoke Tests (Layer 1)`);
  console.log(`   Target: ${BASE}\n`);

  // ── Page Routes ──────────────────────────────────────────
  console.log('  — Page Routes —');

  await test('Homepage loads', async () => {
    const html = await fetchHTML('/');
    assert(!html.includes('data-next-error'), 'Page has React error');
  });

  await test('Homepage has ≥5 context sections', async () => {
    const html = await fetchHTML('/');
    const sections = (html.match(/section-header/g) || []).length;
    assert(sections >= 5, `Only ${sections} sections (need ≥5)`);
  });

  await test('Homepage has ≥10 place cards', async () => {
    const html = await fetchHTML('/');
    const cards = (html.match(/place-card/g) || []).length;
    assert(cards >= 10, `Only ${cards} card refs (need ≥10)`);
  });

  await test('Homepage has ≥5 Blob image URLs', async () => {
    const html = await fetchHTML('/');
    const blobUrls = (html.match(/blob\.vercel-storage\.com/g) || []).length;
    assert(blobUrls >= 5, `Only ${blobUrls} Blob URLs (need ≥5)`);
  });

  await test('Homepage no React errors', async () => {
    const html = await fetchHTML('/');
    assert(!html.includes('data-next-error-message'), 'React error found');
  });

  await test('Places Browse loads', async () => { await fetchHTML('/placecards'); });
  await test('Review Hub loads', async () => { await fetchHTML('/review'); });
  await test("What's Hot loads", async () => { await fetchHTML('/hot'); });
  await test('Admin loads', async () => { await fetchHTML('/admin'); });
  await test('Join Page loads', async () => { await fetchHTML('/u/join'); });

  // ── Place Card Detail ─────────────────────────────────────
  console.log('\n  — Place Card Detail —');

  const TEST_PLACE_ID = 'ChIJiQiJDZTN1IkRTgoWXTMVn1Q'; // known working card
  let detailHtml = '';
  await test('Place card detail loads', async () => {
    detailHtml = await fetchHTML(`/placecards/${TEST_PLACE_ID}`);
    assert(!detailHtml.includes('data-next-error'), 'Has React error');
  });

  await test('Place card has hero image', async () => {
    assert(
      detailHtml.includes('blob.vercel-storage.com') || detailHtml.includes('place-detail-v2-hero'),
      'No hero image or hero section'
    );
  });

  await test('Place card has name heading', async () => {
    assert(detailHtml.includes('place-detail-v2-name') || detailHtml.includes('<h1'), 'No name h1');
  });

  await test('Place card no wrong city (Brooklyn ≠ Toronto)', async () => {
    // If a card is NYC-based, it should not say "Toronto" in the city field
    // Check the meta/JSON content on the page for city consistency
    const jsonMatches = detailHtml.match(/"city"\s*:\s*"([^"]+)"/g) || [];
    for (const m of jsonMatches) {
      const city = m.match(/"city"\s*:\s*"([^"]+)"/)?.[1] || '';
      assert(
        !(city.toLowerCase().includes('toronto') && detailHtml.toLowerCase().includes('brooklyn')),
        `Wrong city: card says Toronto but content mentions Brooklyn`
      );
    }
  });

  await test('Map embed present on place card', async () => {
    assert(
      detailHtml.includes('maps.google.com') || detailHtml.includes('google.com/maps'),
      'No Google Maps embed'
    );
  });

  // ── Hero Image URL validation ─────────────────────────────
  console.log('\n  — Hero Image URLs —');

  await test('Hero image URLs return 200', async () => {
    const blobUrlRe = /https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>]+/g;
    const urls = [...new Set((detailHtml.match(blobUrlRe) || []).filter(u => u.match(/\.(jpg|jpeg|png|webp)/i)).slice(0, 3))];
    if (urls.length === 0) return; // no images to check on this card — pass
    for (const url of urls) {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      assert(res.ok, `Image returned ${res.status}: ${url.slice(-40)}`);
    }
  });

  await test('Homepage Blob images return 200 (sample 3)', async () => {
    const homeHtml = await fetchHTML('/');
    const blobUrlRe = /https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/gi;
    const urls = [...new Set(homeHtml.match(blobUrlRe) || [])].slice(0, 3);
    for (const url of urls) {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      assert(res.ok, `Image returned ${res.status}: ${url.slice(-40)}`);
    }
  });

  // ── City label consistency ────────────────────────────────
  console.log('\n  — City Label Consistency —');

  await test('NYC discoveries not labeled Toronto', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    const discos = data.discoveries || [];
    const nyc = discos.filter(d =>
      (d.contextKey || '').includes('nyc') || (d.contextKey || '').toLowerCase().includes('new-york')
    );
    const wrongCity = nyc.filter(d => d.city && d.city.toLowerCase() === 'toronto');
    assert(wrongCity.length === 0, `${wrongCity.length} NYC discoveries have city=Toronto: ${wrongCity.slice(0,2).map(d=>d.name).join(', ')}`);
  });

  await test('Discoveries have city field (≥90%)', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    const discos = data.discoveries || [];
    if (discos.length === 0) return;
    const withCity = discos.filter(d => d.city && d.city.trim() !== '').length;
    const pct = withCity / discos.length;
    assert(pct >= 0.9, `Only ${(pct * 100).toFixed(0)}% have city (need ≥90%)`);
  });

  // ── API Routes ────────────────────────────────────────────
  console.log('\n  — API Routes —');

  await test('Auth API returns user', async () => {
    const data = await fetchJSON('/api/auth');
    assert(data.user || data._auth, 'No user data');
  });

  await test('Discoveries API returns array', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    assert(Array.isArray(data.discoveries), 'discoveries not an array');
    assert(data.discoveries.length > 0, 'discoveries empty');
  });

  await test('Discoveries count ≥50', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    assert(data.discoveries.length >= 50, `Only ${data.discoveries.length} discoveries`);
  });

  await test('Manifest API returns contexts', async () => {
    const data = await fetchJSON('/api/user/manifest');
    if (data._auth) return;
    assert(data.contexts && data.contexts.length > 0, 'No contexts in manifest');
  });

  await test('Admin Agents: non-zero agents', async () => {
    const data = await fetchJSON('/api/admin/agents');
    if (data._auth) return;
    assert(data.agents && data.agents.length > 0, 'No agents');
    assert(data.stats?.placeCards > 0, 'placeCards is 0');
  });

  await test('Admin Crons: has jobs', async () => {
    const data = await fetchJSON('/api/admin/crons');
    if (data._auth) return;
    assert(data.jobs && data.jobs.length > 0, 'No cron jobs');
  });

  await test('Admin Tokens: has 24h data', async () => {
    const data = await fetchJSON('/api/admin/tokens');
    if (data._auth) return;
    assert(typeof data.total24h === 'number', 'No total24h');
  });

  // ── Triage API end-to-end ─────────────────────────────────
  console.log('\n  — Triage API —');

  await test('GET /api/user/triage returns store', async () => {
    const data = await fetchJSON('/api/user/triage');
    if (data._auth) return;
    // Should be a TriageStore object (keys are contextKeys)
    assert(typeof data === 'object' && data !== null, 'Triage response is not an object');
  });

  await test('POST /api/user/triage accepts save action', async () => {
    // Write a synthetic triage entry for a test place
    const testStore = {
      'radar:test-smoke': {
        triage: {
          'smoke-test-place-id': { state: 'saved', updatedAt: new Date().toISOString() },
        },
      },
    };
    const res = await fetchPage('/api/user/triage', {
      method: 'POST',
      body: testStore,
    });
    assert(res.status === 200, `POST triage returned ${res.status}`);
    const data = await res.json();
    assert(data.ok || data.merged || typeof data === 'object', 'Unexpected response shape');
  });

  await test('POST /api/user/triage handles null triage field gracefully', async () => {
    // This was the bug in issue #99 — client sends { triage: null }
    const badStore = {
      'radar:test-smoke': {
        triage: null, // should not crash
      },
    };
    const res = await fetchPage('/api/user/triage', {
      method: 'POST',
      body: badStore,
    });
    assert(res.status === 200, `POST triage with null returned ${res.status} (expected 200)`);
  });

  await test('POST /api/user/triage rejects without auth', async () => {
    const res = await fetch(`${BASE}/api/user/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ── Security checks ───────────────────────────────────────
  console.log('\n  — Security —');

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

  // ── Data quality ──────────────────────────────────────────
  console.log('\n  — Data Quality —');

  await test('Discoveries: no duplicate place_ids', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    const ids = (data.discoveries || []).map(d => d.place_id).filter(Boolean);
    const unique = new Set(ids);
    assert(unique.size === ids.length, `${ids.length - unique.size} duplicate place_ids`);
  });

  await test('Discoveries: all have contextKey', async () => {
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    const missing = (data.discoveries || []).filter(d => !d.contextKey);
    assert(missing.length === 0, `${missing.length} discoveries missing contextKey`);
  });

  await test('Discoveries: all have valid type', async () => {
    const VALID = new Set(['restaurant','bar','cafe','grocery','gallery','museum','theatre','music-venue','hotel','experience','shop','park','architecture','development','accommodation','neighbourhood']);
    const data = await fetchJSON('/api/user/discoveries');
    if (data._auth) return;
    const invalid = (data.discoveries || []).filter(d => d.type && !VALID.has(d.type));
    assert(invalid.length === 0, `${invalid.length} discoveries with invalid type: ${invalid.slice(0,2).map(d=>`${d.name}=${d.type}`).join(', ')}`);
  });

  await test('Manifest: all contexts have emoji', async () => {
    const data = await fetchJSON('/api/user/manifest');
    if (data._auth) return;
    const missing = (data.contexts || []).filter(c => !c.emoji);
    assert(missing.length === 0, `${missing.length} contexts missing emoji`);
  });

  // ── Summary ───────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${total} total`);

  if (failed > 0) {
    console.log(`\n  ⚠️  ${failed} test(s) failed:`);
    failures.forEach(f => console.log(`     • ${f.name}: ${f.error}`));
    console.log();
    process.exit(1);
  } else {
    console.log(`\n  🎉 All ${total} tests passed!\n`);
    process.exit(0);
  }
}

run();
