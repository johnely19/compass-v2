#!/usr/bin/env node
/* ============================================================
   User Data Validation Script
   Checks all discoveries have required fields, valid contextKeys,
   and proper types. Logs warnings for any issues found.
   
   Usage: node scripts/validate-user-data.mjs [BASE_URL]
   Default: http://localhost:3002
   ============================================================ */

const BASE = process.argv[2] || 'http://localhost:3002';
const COOKIE = 'compass-user=john';

const VALID_TYPES = new Set([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

const CONTEXT_KEY_RE = /^(trip|outing|radar):.+$/;
const PLACE_ID_RE = /^(ChIJ|Eh)/;

async function main() {
  console.log(`\n🔍 User Data Validation — ${BASE}\n`);

  let warnings = 0;
  let errors = 0;

  // Fetch discoveries
  let discoveries = [];
  try {
    const res = await fetch(`${BASE}/api/user/discoveries`, {
      headers: { Cookie: COOKIE },
    });
    if (!res.ok) {
      console.error(`  ❌ Failed to fetch discoveries: ${res.status}`);
      process.exit(1);
    }
    const data = await res.json();
    discoveries = data.discoveries || [];
  } catch (err) {
    console.error(`  ❌ Fetch error: ${err.message}`);
    process.exit(1);
  }

  console.log(`  📊 ${discoveries.length} discoveries found\n`);

  for (let i = 0; i < discoveries.length; i++) {
    const d = discoveries[i];
    const label = `[${i}] ${d.name || '(no name)'}`;

    // Required fields
    if (!d.name) { console.warn(`  ⚠️ ${label}: missing name`); warnings++; }
    if (!d.contextKey) { console.warn(`  ⚠️ ${label}: missing contextKey`); warnings++; }
    if (!d.type) { console.warn(`  ⚠️ ${label}: missing type`); warnings++; }
    if (!d.city) { console.warn(`  ⚠️ ${label}: missing city`); warnings++; }

    // Type validation
    if (d.type && !VALID_TYPES.has(d.type)) {
      console.warn(`  ⚠️ ${label}: invalid type '${d.type}'`);
      warnings++;
    }

    // ContextKey format
    if (d.contextKey && !CONTEXT_KEY_RE.test(d.contextKey)) {
      console.warn(`  ⚠️ ${label}: invalid contextKey '${d.contextKey}'`);
      warnings++;
    }

    // Place ID format (if present)
    if (d.place_id && typeof d.place_id === 'string' && d.place_id.length > 3 && !PLACE_ID_RE.test(d.place_id)) {
      // Not necessarily an error — some valid IDs don't start with ChIJ
      // but flag cottage/dev IDs as info
      if (!d.place_id.includes('-') && d.place_id.length > 20) {
        // Looks like a Google Place ID that doesn't match pattern
      }
    }

    // Rating should be a number
    if (d.rating !== undefined && d.rating !== null && typeof d.rating !== 'number') {
      console.warn(`  ⚠️ ${label}: rating is ${typeof d.rating} '${d.rating}', should be number`);
      warnings++;
    }
  }

  // Check for context coverage
  const contextKeys = new Set(discoveries.map(d => d.contextKey).filter(Boolean));
  console.log(`  📋 ${contextKeys.size} unique contexts: ${[...contextKeys].join(', ')}`);

  // Summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${discoveries.length} discoveries, ${warnings} warnings, ${errors} errors`);

  if (warnings === 0 && errors === 0) {
    console.log('  ✅ All data valid!\n');
  } else {
    console.log(`  ⚠️ ${warnings + errors} issue(s) found\n`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

main();
