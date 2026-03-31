#!/usr/bin/env node
// scripts/cleanup-discovery-duplicates.mjs
// Usage: node scripts/cleanup-discovery-duplicates.mjs [--write]

import { put, list, del } from '@vercel/blob';
import { readFileSync } from 'fs';

const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_PREFIX = 'users';

if (!BLOB_READ_WRITE_TOKEN) {
  console.error('Error: BLOB_READ_WRITE_TOKEN env var required');
  process.exit(1);
}

/** Normalise place name for dedup matching */
function normaliseName(n) {
  return n.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Merge discoveries by place_id: keep the one with more data (description, address, rating) */
function mergeByPlaceId(discoveries) {
  const seen = new Map(); // "place_id:contextKey" → index
  const result = [];
  for (const d of discoveries) {
    const rec = d;
    const pid = rec.place_id;
    const ctx = rec.contextKey || "";
    if (pid) {
      const k = `${pid}:${ctx}`;
      if (seen.has(k)) {
        const existingIdx = seen.get(k);
        const existing = result[existingIdx];
        // Keep whichever has more data
        const incomingScore = [rec.description, rec.address, rec.rating].filter(Boolean).length;
        const existingScore = [existing?.description, existing?.address, existing?.rating].filter(Boolean).length;
        if (incomingScore > existingScore) {
          result[existingIdx] = d;
        }
        continue;
      }
      seen.set(k, result.length);
    }
    result.push(d);
  }
  return result;
}

/** Apply full dedup logic: name+context dedup + place_id dedup */
function dedupDiscoveries(discoveries) {
  // Build name-based index: normalised_name:contextKey → index
  const byName = new Map();
  const result = [];

  for (let i = 0; i < discoveries.length; i++) {
    const d = discoveries[i];
    const name = d.name;
    const ctx = d.contextKey || "";

    if (!name) {
      result.push(d);
      continue;
    }

    const normKey = `${normaliseName(name)}:${ctx}`;
    const existingIdx = byName.get(normKey);

    if (existingIdx !== undefined) {
      // Already have this name+context - apply upgrade logic
      const existing = result[existingIdx];
      const existingHasPlaceId = !!existing?.place_id;
      const incomingHasPlaceId = !!d.place_id;

      if (incomingHasPlaceId && !existingHasPlaceId) {
        // Upgrade: replace existing with incoming (keeps existing id)
        result[existingIdx] = { ...existing, ...d, id: existing.id };
      }
      // Otherwise discard incoming (duplicate)
      continue;
    }

    byName.set(normKey, result.length);
    result.push(d);
  }

  // Apply place_id merge (keep entry with more data)
  return mergeByPlaceId(result);
}

/** Read discoveries from Blob */
async function readDiscoveries(userId) {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) return [];
    const res = await fetch(blob.url);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data?.discoveries) return data.discoveries;
    return [];
  } catch (e) {
    console.error(`Error reading discoveries for ${userId}:`, e.message);
    return [];
  }
}

/** Write discoveries to Blob */
async function writeDiscoveries(userId, discoveries) {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
  // Delete existing
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) await del(existing.url);
  } catch { /* ignore */ }

  const payload = { discoveries, updatedAt: new Date().toISOString() };
  await put(blobPath, JSON.stringify(payload, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

/** Load users from data/users.json */
function loadUsers() {
  const raw = readFileSync('data/users.json', 'utf8');
  const data = JSON.parse(raw);
  const usersObj = data.users || {};
  return Object.values(usersObj)
    .filter(u => u.active !== false) // Skip inactive users
    .map(u => u.id);
}

async function main() {
  const write = process.argv.includes('--write');

  console.log('=== Discovery Duplicate Cleanup ===\n');
  console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN (use --write to save)'}\n`);

  const userIds = loadUsers();
  console.log(`Found ${userIds.length} active users: ${userIds.join(', ')}\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let totalRemoved = 0;

  for (const userId of userIds) {
    const before = await readDiscoveries(userId);
    const beforeCount = before.length;
    totalBefore += beforeCount;

    if (beforeCount === 0) {
      console.log(`${userId}: 0 discoveries (skip)`);
      continue;
    }

    const after = dedupDiscoveries(before);
    const afterCount = after.length;
    totalAfter += afterCount;

    const removed = beforeCount - afterCount;
    totalRemoved += removed;

    if (removed > 0) {
      console.log(`${userId}: ${beforeCount} → ${afterCount} discoveries (removed ${removed} duplicates)`);

      if (write) {
        await writeDiscoveries(userId, after);
        console.log(`  → Saved changes`);
      }
    } else {
      console.log(`${userId}: ${beforeCount} discoveries (no duplicates)`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total: ${totalBefore} → ${totalAfter} discoveries (removed ${totalRemoved} duplicates)`);

  if (!write) {
    console.log('\nDRY-RUN complete. Run with --write to apply changes.');
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});