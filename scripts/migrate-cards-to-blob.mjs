#!/usr/bin/env node
/**
 * Migrate all local data/placecards/ to Vercel Blob.
 * Blob path structure:
 *   place-cards/{place_id}/card.json
 *   place-cards/{place_id}/manifest.json  (if exists)
 *   place-cards/index.json               (built from local index)
 *
 * Usage:
 *   node scripts/migrate-cards-to-blob.mjs            # dry-run
 *   node scripts/migrate-cards-to-blob.mjs --write    # upload to Blob
 *   node scripts/migrate-cards-to-blob.mjs --write --resume  # skip already-uploaded
 *   node scripts/migrate-cards-to-blob.mjs --write --limit=10  # test with 10 cards
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { list, put } from '@vercel/blob';

const DATA_DIR = join(process.cwd(), 'data', 'placecards');
const BLOB_PREFIX = 'place-cards';

// ---- Args ----

const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const resumeMode = args.includes('--resume');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

if (!writeMode) {
  console.log('\n🔍 DRY RUN — use --write to upload to Blob\n');
}

// ---- Blob helpers ----

async function blobPut(blobPath, content, contentType = 'application/json') {
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await put(blobPath, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
  });
}

async function blobList(prefix) {
  const { blobs } = await list({ prefix, limit: 1000 });
  return blobs;
}

// ---- Load local data ----

function loadIndex() {
  const indexPath = join(DATA_DIR, 'index.json');
  if (!existsSync(indexPath)) return {};
  return JSON.parse(readFileSync(indexPath, 'utf-8'));
}

function getCardDirs() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => {
      const cardPath = join(DATA_DIR, name, 'card.json');
      return existsSync(cardPath);
    });
}

function loadCard(placeId) {
  const cardPath = join(DATA_DIR, placeId, 'card.json');
  if (!existsSync(cardPath)) return null;
  return JSON.parse(readFileSync(cardPath, 'utf-8'));
}

function loadManifest(placeId) {
  const manifestPath = join(DATA_DIR, placeId, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

// ---- Main ----

async function main() {
  console.log(`\n📦 Migrate Place Cards to Blob — ${new Date().toISOString()}\n`);

  // Load index and card directories
  const index = loadIndex();
  const cardDirs = getCardDirs();
  const total = cardDirs.length;

  console.log(`  Found ${total} cards in ${DATA_DIR}\n`);

  // Build map of already-uploaded cards (for resume)
  const uploaded = new Set();
  if (resumeMode && writeMode) {
    console.log('  Checking for already-uploaded cards...');
    try {
      const blobs = await blobList(BLOB_PREFIX + '/');
      for (const b of blobs) {
        const match = b.pathname.match(/^place-cards\/([^/]+)\/card\.json$/);
        if (match) uploaded.add(match[1]);
      }
      console.log(`  Already uploaded: ${uploaded.size} cards\n`);
    } catch (err) {
      console.error(`  Failed to list blobs: ${err.message}`);
    }
  }

  // Process each card
  let uploadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let totalBytes = 0;

  for (let i = 0; i < Math.min(cardDirs.length, limit); i++) {
    const placeId = cardDirs[i];
    const name = index[placeId]?.name || placeId;

    // Skip if already uploaded (resume mode)
    if (resumeMode && uploaded.has(placeId)) {
      skippedCount++;
      continue;
    }

    // Load card and manifest
    const card = loadCard(placeId);
    const manifest = loadManifest(placeId);

    if (!card) {
      console.error(`  [${i + 1}/${total}] ${placeId} — SKIP (no card.json)`);
      errorCount++;
      continue;
    }

    // Upload card.json
    if (writeMode) {
      try {
        await blobPut(`${BLOB_PREFIX}/${placeId}/card.json`, card);
        totalBytes += JSON.stringify(card).length;
      } catch (err) {
        console.error(`  [${i + 1}/${total}] ${placeId} — ERROR: ${err.message}`);
        errorCount++;
        continue;
      }

      // Upload manifest.json if exists
      if (manifest) {
        try {
          await blobPut(`${BLOB_PREFIX}/${placeId}/manifest.json`, manifest);
          totalBytes += JSON.stringify(manifest).length;
        } catch (err) {
          console.warn(`  [${i + 1}/${total}] ${placeId}/manifest.json — WARNING: ${err.message}`);
        }
      }

      // Rate limit: 100ms between uploads
      await new Promise(r => setTimeout(r, 100));
    }

    uploadedCount++;
    console.log(`  [${uploadedCount + skippedCount}/${total}] ${placeId} — ${name}`);
  }

  // Upload index.json
  if (writeMode && uploadedCount > 0) {
    console.log('\n  Uploading index.json...');
    try {
      await blobPut(`${BLOB_PREFIX}/index.json`, index);
      totalBytes += JSON.stringify(index).length;
      console.log('  ✅ index.json uploaded');
    } catch (err) {
      console.error(`  ❌ index.json failed: ${err.message}`);
      errorCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Summary:`);
  console.log(`   Cards uploaded: ${uploadedCount}`);
  console.log(`   Cards skipped:  ${skippedCount}`);
  console.log(`   Errors:         ${errorCount}`);
  console.log(`   Total bytes:   ${(totalBytes / 1024).toFixed(1)} KB\n`);

  if (!writeMode) {
    console.log('🔍 DRY RUN complete — re-run with --write to upload\n');
  } else {
    console.log('✅ Migration complete\n');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
