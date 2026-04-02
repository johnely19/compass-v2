/* ============================================================
   Compass v2 — Saved Places (Canonical, Append-Only Store)
   
   users/{userId}/saved.json — the SINGLE source of truth for
   what the user has saved. Rules:
   
   1. APPEND-ONLY — no process may remove entries. Ever.
   2. Deduped by place_id + contextKey (same place in different
      contexts = separate saves)
   3. Self-contained — each entry has ALL fields needed to render
      a card, no dependency on discoveries.json
   4. Unsave = set unsavedAt timestamp, never delete
   
   Issue #204: Saves are FOREVER.
   ============================================================ */

import { list, put, del } from '@vercel/blob';
import type { SavedPlace, SavedPlacesStore, Discovery } from './types';

const BLOB_PREFIX = 'users';

/* ---------- Read / Write ---------- */

export async function getSavedPlaces(userId: string): Promise<SavedPlacesStore> {
  const blobPath = `${BLOB_PREFIX}/${userId}/saved.json`;
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) return { saved: [], updatedAt: new Date().toISOString() };
    const res = await fetch(blob.url);
    if (!res.ok) return { saved: [], updatedAt: new Date().toISOString() };
    const data = await res.json();
    // Handle legacy shapes
    if (data && Array.isArray(data.saved)) return data as SavedPlacesStore;
    return { saved: [], updatedAt: new Date().toISOString() };
  } catch {
    return { saved: [], updatedAt: new Date().toISOString() };
  }
}

async function writeSavedPlaces(userId: string, store: SavedPlacesStore): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${userId}/saved.json`;
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) await del(existing.url);
  } catch { /* ignore */ }

  store.updatedAt = new Date().toISOString();
  await put(blobPath, JSON.stringify(store, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

/* ---------- Dedup key ---------- */

function savedKey(entry: { place_id?: string; name: string; contextKey: string }): string {
  if (entry.place_id) return `pid:${entry.place_id}:${entry.contextKey}`;
  return `name:${entry.name.toLowerCase().trim()}:${entry.contextKey}`;
}

/* ---------- Save a place ---------- */

/**
 * Add a place to saved.json (append-only).
 * Deduplicates by place_id+contextKey. If already exists, no-op.
 * Returns true if a new entry was added.
 */
export async function savePlaceToSaved(
  userId: string,
  place: Omit<SavedPlace, 'savedAt'> & { savedAt?: string },
): Promise<boolean> {
  const store = await getSavedPlaces(userId);
  const key = savedKey({ place_id: place.place_id, name: place.name, contextKey: place.contextKey });

  // Check for existing (including unsaved ones — re-saving restores them)
  const existingIdx = store.saved.findIndex(s => savedKey(s) === key);

  if (existingIdx >= 0) {
    const existingEntry = store.saved[existingIdx]!;
    if (existingEntry.unsavedAt) {
      // Re-saving: clear unsavedAt to restore
      existingEntry.unsavedAt = undefined;
      existingEntry.savedAt = new Date().toISOString();
      await writeSavedPlaces(userId, store);
      console.log(`[saved-places] Re-saved "${place.name}" in ${place.contextKey} for ${userId}`);
      return true;
    }
    // Already saved and active — no-op
    return false;
  }

  // New save — append
  const entry: SavedPlace = {
    place_id: place.place_id,
    name: place.name,
    address: place.address,
    city: place.city,
    type: place.type,
    rating: place.rating,
    contextKey: place.contextKey,
    savedAt: place.savedAt || new Date().toISOString(),
    source: place.source,
    description: place.description,
    why: place.why,
    heroImage: place.heroImage,
    lat: place.lat,
    lng: place.lng,
    discoveryId: place.discoveryId,
    sourceUrl: place.sourceUrl,
    sourceName: place.sourceName,
    ratingCount: place.ratingCount,
  };

  store.saved.push(entry);
  await writeSavedPlaces(userId, store);
  console.log(`[saved-places] Saved "${place.name}" in ${place.contextKey} for ${userId} (total: ${store.saved.length})`);
  return true;
}

/* ---------- Unsave a place ---------- */

/**
 * Mark a place as unsaved by setting unsavedAt timestamp.
 * DOES NOT remove from saved.json — preserves full history.
 */
export async function unsavePlace(
  userId: string,
  placeId: string,
  contextKey: string,
): Promise<boolean> {
  const store = await getSavedPlaces(userId);

  const entry = store.saved.find(s =>
    (s.place_id === placeId || s.discoveryId === placeId) && s.contextKey === contextKey,
  );

  if (!entry || entry.unsavedAt) return false;

  entry.unsavedAt = new Date().toISOString();
  await writeSavedPlaces(userId, store);
  console.log(`[saved-places] Unsaved "${entry.name}" in ${contextKey} for ${userId}`);
  return true;
}

/* ---------- Query helpers ---------- */

/**
 * Get active saved places (where unsavedAt is null/undefined).
 * Optionally filter by contextKey.
 */
export function getActiveSaved(store: SavedPlacesStore, contextKey?: string): SavedPlace[] {
  return store.saved.filter(s =>
    !s.unsavedAt && (contextKey ? s.contextKey === contextKey : true),
  );
}

/**
 * Get count of active saved places per context.
 */
export function getSavedCountsByContext(store: SavedPlacesStore): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of store.saved) {
    if (!s.unsavedAt) {
      counts[s.contextKey] = (counts[s.contextKey] || 0) + 1;
    }
  }
  return counts;
}

/* ---------- Build SavedPlace from Discovery ---------- */

/**
 * Convert a Discovery record to a SavedPlace with all fields needed
 * to render a card (self-contained, no dependency on discoveries.json).
 */
export function discoveryToSavedPlace(
  discovery: Discovery,
  source: string = 'triage:save',
): Omit<SavedPlace, 'savedAt'> {
  return {
    place_id: discovery.place_id,
    name: discovery.name,
    address: discovery.address,
    city: discovery.city,
    type: discovery.type,
    rating: discovery.rating,
    contextKey: discovery.contextKey,
    source,
    description: discovery.description,
    why: discovery.why,
    heroImage: discovery.heroImage,
    lat: discovery.lat,
    lng: discovery.lng,
    discoveryId: discovery.id,
    sourceUrl: discovery.sourceUrl,
    sourceName: discovery.sourceName,
    ratingCount: discovery.ratingCount,
  };
}

/* ---------- Reconciliation ---------- */

/**
 * Reconcile triage saves with saved.json.
 * For any triage save that's missing from saved.json, attempt recovery
 * from discoveries.json.
 */
export async function reconcileSavedPlaces(
  userId: string,
  triageSavedIds: Map<string, { contextKey: string; discoveryId: string }>,
  discoveries: Discovery[],
): Promise<{ recovered: number; orphaned: number }> {
  const store = await getSavedPlaces(userId);
  const existingKeys = new Set(store.saved.map(s => savedKey(s)));
  let recovered = 0;
  let orphaned = 0;

  for (const [, info] of triageSavedIds) {
    // Find discovery for this triage save
    const discovery = discoveries.find(d => d.id === info.discoveryId);
    if (!discovery) {
      orphaned++;
      continue;
    }

    const key = savedKey({
      place_id: discovery.place_id,
      name: discovery.name,
      contextKey: info.contextKey,
    });

    if (!existingKeys.has(key)) {
      // Missing from saved.json — recover it
      const saved = discoveryToSavedPlace(discovery, 'reconciliation:recovery');
      store.saved.push({
        ...saved,
        savedAt: new Date().toISOString(),
      });
      existingKeys.add(key);
      recovered++;
    }
  }

  if (recovered > 0) {
    await writeSavedPlaces(userId, store);
    console.log(`[saved-places] Reconciliation: recovered ${recovered}, orphaned ${orphaned} for ${userId}`);
  }

  return { recovered, orphaned };
}
