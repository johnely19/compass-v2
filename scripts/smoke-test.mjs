#!/usr/bin/env node
/* ============================================================
   Compass V2 — Smoke Test Suite
   Tests all critical endpoints against a running server.
   Usage: node scripts/smoke-test.mjs [BASE_URL]
   Default: http://localhost:3001
   ============================================================ */

const BASE = process.argv[2] || 'http://localhost:3001';

const results = [];
let passed = 0;
let failed = 0;

async function test(name, url, opts = {}) {
  const { method = 'GET', expectedStatus = 200, body, headers = {} } = opts;
  try {
    const fetchOpts = { method, headers: { ...headers } };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers['Content-Type'] = 'application/json';
    }
    // Follow redirects manually to capture status
    fetchOpts.redirect = 'manual';

    const res = await fetch(`${BASE}${url}`, fetchOpts);
    const status = res.status;

    // Accept the expected status, or 200-399 range for pages, or 401 (alive but auth required)
    const ok = status === expectedStatus ||
      (expectedStatus === 200 && status >= 200 && status < 400) ||
      status === 401; // auth required = server is alive

    if (ok) {
      results.push({ name, status, ok: true });
      passed++;
      console.log(`  ✅ ${name} (${status})`);
    } else {
      results.push({ name, status, ok: false, expected: expectedStatus });
      failed++;
      console.log(`  ❌ ${name} — expected ${expectedStatus}, got ${status}`);
    }
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    failed++;
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

async function run() {
  console.log(`\n🧭 Compass V2 Smoke Tests`);
  console.log(`   Target: ${BASE}\n`);

  // Page routes
  await test('Homepage', '/');
  await test('Places Browse', '/placecards');
  await test('Review Hub', '/review');
  await test('What\'s Hot', '/hot');
  await test('Admin (owner-only)', '/admin');
  await test('Join Page', '/u/join');

  // API routes
  await test('Auth API', '/api/auth');
  await test('Discoveries GET', '/api/user/discoveries');
  await test('Briefing Ingest GET', '/api/briefing-ingest?userId=john');
  await test('Context Lifecycle GET', '/api/contexts/lifecycle');

  // Admin APIs
  await test('Admin Users API', '/api/admin/users');
  await test('Admin Agents API', '/api/admin/agents');
  await test('Admin Crons API', '/api/admin/crons');

  // Chat API (POST with test payload)
  await test('Chat API (POST)', '/api/chat', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hello' }] },
    expectedStatus: 200,
  });

  // Discovery push (POST without auth — should 401)
  await test('Discovery Push (no auth)', '/api/user/discoveries', {
    method: 'POST',
    body: { discoveries: [] },
    expectedStatus: 401,
  });

  // Briefing ingest (POST without token — should 401)
  await test('Briefing Ingest (no token)', '/api/briefing-ingest', {
    method: 'POST',
    body: { summary: 'test' },
    expectedStatus: 401,
  });

  // Place card detail (random known card)
  await test('Place Card Detail', '/placecards/ChIJiQiJDZTN1IkRTgoWXTMVn1Q');

  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) {
    console.log(`\n  ⚠️  ${failed} test(s) failed\n`);
    process.exit(1);
  } else {
    console.log(`\n  🎉 All tests passed!\n`);
    process.exit(0);
  }
}

run();
