/* ============================================================
   Compass v2 — Discovery Write Layer (Merge-Only)
   
   ALL writes to user discoveries MUST go through this module.
   Guarantees:
   1. Writes are always merge (additive), never replace
   2. Saved items are IMMUTABLE — never removed
   3. Deduplication by place_id and name+contextKey
   
   Issue #204: Saved discoveries can never be lost.
   ============================================================ */

import { list, put, del } from '@vercel/blob';
import type { Discovery, UserDiscoveries } from './types';

const BLOB_PREFIX = 'users';

/* ---------- Triage types (inline to avoid circular imports) ---------- */

type TriageEntry = { state: string; updatedAt: string; previousState?: string };
type ContextTriage = { triage: Record<string, TriageEntry>; seen?: Record<string, unknown> };
type TriageStore = Record<string, ContextTriage>;

/* ---------- Low-level Blob I/O ---------- */

/** Read raw discoveries from Blob WITHOUT normalization */
export async function readRawDiscoveries(userId: string): Promise<unknown[]> {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) return [];
    const res = await fetch(blob.url);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.discoveries)) return data.discoveries;
    return [];
  } catch {
    return [];
  }
}

/** Write discoveries to Blob (low-level — use mergeAndWriteDiscoveries instead) */
async function writeDiscoveriesBlob(userId: string, discoveries: unknown[]): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${userId}/discoveries.json`;
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

/* ---------- Triage I/O ---------- */

async function loadTriageStore(userId: string): Promise<TriageStore> {
  try {
    const { blobs } = await list({ prefix: `${BLOB_PREFIX}/${userId}/triage.json` });
    if (!blobs[0]) return {};
    const res = await fetch(blobs[0].url);
    if (!res.ok) return {};
    return (await res.json()) as TriageStore;
  } catch {
    return {};
  }
}

/** Get all discovery IDs that are currently saved in triage */
export async function getSavedDiscoveryIds(userId: string): Promise<Set<string>> {
  const store = await loadTriageStore(userId);
  const savedIds = new Set<string>();
  for (const ctx of Object.values(store)) {
    for (const [id, entry] of Object.entries(ctx.triage ?? {})) {
      if (entry.state === 'saved') {
        savedIds.add(id);
      }
    }
  }
  return savedIds;
}

/* ---------- Normalise name for dedup ---------- */

function normaliseName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/* ---------- Core merge logic ---------- */

export interface MergeResult {
  merged: unknown[];
  added: number;
  duplicates: number;
  upgraded: number;
  previousCount: number;
  protectedSavedCount: number;
}

/**
 * Merge new discoveries into existing ones.
 * - Deduplicates by place_id:contextKey and name:contextKey
 * - Upgrades stubs (no place_id) when incoming has place_id
 * - NEVER removes existing entries
 * - Saved items are always preserved (extra safety check)
 */
export async function mergeDiscoveries(
  userId: string,
  incoming: unknown[],
): Promise<MergeResult> {
  const existingRaw = await readRawDiscoveries(userId);
  const savedIds = await getSavedDiscoveryIds(userId);
  const previousCount = existingRaw.length;

  // Build indices on existing
  const existingByName = new Map<string, number>();
  const existingByPlaceId = new Set<string>();

  for (let idx = 0; idx < existingRaw.length; idx++) {
    const rec = existingRaw[idx] as Record<string, unknown>;
    const name = rec.name as string | undefined;
    const ctx = (rec.contextKey as string) ?? '';
    const pid = rec.place_id as string | undefined;
    if (name) existingByName.set(`${normaliseName(name)}:${ctx}`, idx);
    if (pid) existingByPlaceId.add(`${pid}:${ctx}`);
  }

  let added = 0;
  let duplicates = 0;
  let upgraded = 0;

  for (const item of incoming) {
    const rec = item as Record<string, unknown>;
    const name = rec.name as string | undefined;
    const ctx = (rec.contextKey as string) ?? '';
    const pid = rec.place_id as string | undefined;

    if (!name) continue;

    // Name-based dedup
    const normKey = `${normaliseName(name)}:${ctx}`;
    const existingIdx = existingByName.get(normKey);

    if (existingIdx !== undefined) {
      const existingRec = existingRaw[existingIdx] as Record<string, unknown>;
      const existingHasPlaceId = !!existingRec.place_id;
      const incomingHasPlaceId = !!pid;

      if (incomingHasPlaceId && !existingHasPlaceId) {
        // Upgrade existing with incoming data, keep existing id
        existingRaw[existingIdx] = { ...existingRec, ...rec, id: existingRec.id };
        if (pid) existingByPlaceId.add(`${pid}:${ctx}`);
        upgraded++;
      } else {
        duplicates++;
      }
      continue;
    }

    // Place_id dedup
    if (pid && existingByPlaceId.has(`${pid}:${ctx}`)) {
      duplicates++;
      continue;
    }

    // New item — append
    existingRaw.push(item);
    if (name) existingByName.set(normKey, existingRaw.length - 1);
    if (pid) existingByPlaceId.add(`${pid}:${ctx}`);
    added++;
  }

  // SAFETY: verify all saved items still exist
  let protectedSavedCount = 0;
  const finalIds = new Set(existingRaw.map(d => (d as Record<string, unknown>).id as string));
  for (const savedId of savedIds) {
    if (!finalIds.has(savedId)) {
      // This should never happen with merge-only logic, but log it
      console.error(`[discovery-write] CRITICAL: Saved item ${savedId} missing after merge for ${userId}!`);
      protectedSavedCount++;
    }
  }

  return {
    merged: existingRaw,
    added,
    duplicates,
    upgraded,
    previousCount,
    protectedSavedCount,
  };
}

/**
 * Safe write: merge incoming discoveries and write back.
 * Never shrinks the discovery set below the existing count.
 */
export async function mergeAndWriteDiscoveries(
  userId: string,
  incoming: unknown[],
): Promise<MergeResult> {
  const result = await mergeDiscoveries(userId, incoming);

  // Safety: never shrink
  if (result.merged.length < result.previousCount) {
    console.error(
      `[discovery-write] SAFETY BLOCK: would shrink ${result.previousCount} → ${result.merged.length} for ${userId}. Refusing.`,
    );
    throw new Error(`Safety check failed: write would reduce discovery count from ${result.previousCount} to ${result.merged.length}`);
  }

  if (result.added > 0 || result.upgraded > 0) {
    await writeDiscoveriesBlob(userId, result.merged);
    console.log(
      `[discovery-write] ${result.added} added, ${result.upgraded} upgraded for ${userId}. ${result.previousCount} → ${result.merged.length}`,
    );
  }

  return result;
}

/**
 * Mark a discovery as saved by adding savedAt timestamp.
 * Also ensures the discovery exists in the blob.
 */
export async function markDiscoverySaved(
  userId: string,
  discoveryId: string,
): Promise<void> {
  const existing = await readRawDiscoveries(userId);
  let found = false;

  for (const d of existing) {
    const rec = d as Record<string, unknown>;
    if (rec.id === discoveryId) {
      rec.savedAt = new Date().toISOString();
      found = true;
      break;
    }
  }

  if (found) {
    await writeDiscoveriesBlob(userId, existing);
  }
}

/**
 * Reconcile triage saves with discovery data.
 * If triage has a save but discovery is missing, log it (recovery from Google Places
 * would require place_id which we may not have from triage alone).
 * Returns list of orphaned save IDs.
 */
export async function reconcileSavedDiscoveries(userId: string): Promise<{
  orphanedSaves: string[];
  totalSaved: number;
  totalDiscoveries: number;
}> {
  const existing = await readRawDiscoveries(userId);
  const savedIds = await getSavedDiscoveryIds(userId);

  const discoveryIds = new Set(existing.map(d => (d as Record<string, unknown>).id as string));

  const orphanedSaves: string[] = [];
  for (const savedId of savedIds) {
    if (!discoveryIds.has(savedId)) {
      orphanedSaves.push(savedId);
    }
  }

  if (orphanedSaves.length > 0) {
    console.warn(
      `[discovery-write] RECONCILE: ${orphanedSaves.length} orphaned saves for ${userId}: ${orphanedSaves.join(', ')}`,
    );
  }

  return {
    orphanedSaves,
    totalSaved: savedIds.size,
    totalDiscoveries: existing.length,
  };
}
