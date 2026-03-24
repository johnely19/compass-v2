#!/usr/bin/env node
/* ============================================================
   Blob Data Backup Script
   Copies users/{id}/discoveries.json → users/{id}/discoveries.backup.json
   Run daily via cron to protect against data loss.
   ============================================================ */

import { list, put } from '@vercel/blob';

const USERS = ['john', 'billy']; // Add user IDs here

async function backupUser(userId) {
  const prefix = `users/${userId}/discoveries.json`;
  const backupPath = `users/${userId}/discoveries.backup.json`;

  try {
    const { blobs } = await list({ prefix, limit: 1 });
    const blob = blobs[0];
    if (!blob) {
      console.log(`  ${userId}: no discoveries.json found`);
      return;
    }

    const res = await fetch(blob.url);
    if (!res.ok) {
      console.log(`  ${userId}: failed to fetch (${res.status})`);
      return;
    }

    const data = await res.text();
    const parsed = JSON.parse(data);
    const count = Array.isArray(parsed) ? parsed.length :
      Array.isArray(parsed.discoveries) ? parsed.discoveries.length : 0;

    // Write backup
    await put(backupPath, data, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    console.log(`  ${userId}: backed up ${count} discoveries`);
  } catch (err) {
    console.error(`  ${userId}: backup failed — ${err.message}`);
  }
}

async function main() {
  console.log(`\n📦 Blob Data Backup — ${new Date().toISOString()}\n`);

  for (const userId of USERS) {
    await backupUser(userId);
  }

  console.log('\nDone.\n');
}

main();
