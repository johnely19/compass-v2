#!/usr/bin/env node
/**
 * Test script for OpenClaw Gateway HTTP API
 * Verifies /v1/models and /v1/chat/completions work correctly.
 *
 * Usage:
 *   node scripts/test-gateway-api.mjs [base-url] [token]
 *
 * Defaults:
 *   base-url: http://127.0.0.1:18789
 *   token: from OPENCLAW_GATEWAY_TOKEN env var
 */

const BASE_URL = process.argv[2] || 'http://127.0.0.1:18789';
const TOKEN = process.argv[3] || process.env.OPENCLAW_GATEWAY_TOKEN;

if (!TOKEN) {
  console.error('❌ No token provided. Pass as arg or set OPENCLAW_GATEWAY_TOKEN');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-openclaw-scopes': 'operator.read,operator.write',
  'Content-Type': 'application/json',
};

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log(`\nTesting Gateway HTTP API at ${BASE_URL}\n`);

// Test 1: /v1/models
await test('GET /v1/models returns model list', async () => {
  const res = await fetch(`${BASE_URL}/v1/models`, { headers: HEADERS });
  assert(res.ok, `HTTP ${res.status}`);
  const data = await res.json();
  assert(data.object === 'list', `Expected object=list, got ${data.object}`);
  assert(Array.isArray(data.data), 'Expected data to be array');
  assert(data.data.length > 0, 'Expected at least one model');
  const ids = data.data.map(m => m.id);
  assert(ids.includes('openclaw/default'), `Missing openclaw/default in: ${ids.join(', ')}`);
  console.log(`       Models: ${ids.join(', ')}`);
});

// Test 2: /v1/models without scopes header should fail
await test('GET /v1/models without scopes header returns 403', async () => {
  const res = await fetch(`${BASE_URL}/v1/models`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(res.status === 403, `Expected 403, got ${res.status}`);
  const data = await res.json();
  assert(data.error?.message?.includes('missing scope'), `Expected scope error, got: ${JSON.stringify(data)}`);
});

// Test 3: /v1/chat/completions
await test('POST /v1/chat/completions returns completion', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      model: 'openclaw/default',
      messages: [{ role: 'user', content: 'Reply with exactly the word "pong"' }],
    }),
  });
  const text = await res.text();
  assert(res.ok, `HTTP ${res.status}: ${text}`);
  const data = JSON.parse(text);
  assert(data.object === 'chat.completion', `Expected chat.completion, got ${data.object}`);
  assert(data.choices?.length > 0, 'Expected at least one choice');
  assert(typeof data.choices[0].message?.content === 'string', 'Expected string content');
  console.log(`       Response: "${data.choices[0].message.content.slice(0, 80)}"`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
