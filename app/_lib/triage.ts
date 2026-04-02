/* ============================================================
   Compass v2 — Triage System
   localStorage = fast local cache
   Vercel Blob = persistent truth (synced via /api/user/triage)
   ============================================================ */

import type { TriageState, TriageEntry, SeenEntry, ContextTriage, TriageStore, DiscoveryType } from './types';

// ---- Storage ----

function storageKey(userId: string): string {
  return `compass-triage-${userId}`;
}

function loadStore(userId: string): TriageStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as TriageStore) : {};
  } catch {
    return {};
  }
}

function saveStore(userId: string, store: TriageStore): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(userId), JSON.stringify(store));
  // Fire custom event for cross-component reactivity
  window.dispatchEvent(new CustomEvent('triage-changed', { detail: { userId } }));
}

function ensureContext(store: TriageStore, contextKey: string): ContextTriage {
  if (!store[contextKey]) {
    store[contextKey] = { triage: {}, seen: {} };
  }
  return store[contextKey];
}

// ---- Server sync ----

/**
 * Merge two TriageStore objects — keep the entry with the later updatedAt.
 * Mirrors the server-side merge logic in /api/user/triage.
 */
function mergeStores(local: TriageStore, remote: TriageStore): TriageStore {
  const merged: TriageStore = {};
  const allContexts = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const ctx of allContexts) {
    const lCtx = local[ctx] ?? { triage: {}, seen: {} };
    const rCtx = remote[ctx] ?? { triage: {}, seen: {} };

    const mergedTriage: Record<string, TriageEntry> = {};
    const allPlaces = new Set([...Object.keys(lCtx.triage ?? {}), ...Object.keys(rCtx.triage ?? {})]);

    for (const placeId of allPlaces) {
      const lEntry = lCtx.triage[placeId];
      const rEntry = rCtx.triage[placeId];

      if (!lEntry) { mergedTriage[placeId] = rEntry!; continue; }
      if (!rEntry) { mergedTriage[placeId] = lEntry!; continue; }

      // Both exist — keep whichever is newer (remote wins ties)
      const lTime = new Date(lEntry.updatedAt).getTime();
      const rTime = new Date(rEntry.updatedAt).getTime();
      mergedTriage[placeId] = rTime >= lTime ? rEntry : lEntry;
    }

    // Merge seen (union — once seen, always seen)
    const mergedSeen = { ...(lCtx.seen ?? {}), ...(rCtx.seen ?? {}) } as Record<string, SeenEntry>;

    merged[ctx] = { triage: mergedTriage, seen: mergedSeen };
  }

  return merged;
}

/**
 * Hydrate localStorage from Blob on app startup.
 * Call once from HomeClient on mount.
 * Remote wins for conflicts (Blob is the persistent truth).
 */
export async function hydrateFromServer(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/user/triage', { credentials: 'include' });
    if (!res.ok) return; // silently fail — localStorage is still usable

    const remoteStore = (await res.json()) as TriageStore;
    const localStore = loadStore(userId);

    // Only update if remote has data
    const hasRemoteData = Object.keys(remoteStore).length > 0;
    if (!hasRemoteData) {
      // Remote is empty — push our local state up so it survives browser clear
      const hasLocalData = Object.keys(localStore).length > 0;
      if (hasLocalData) {
        syncToServer(userId).catch(() => {/* fire-and-forget */});
      }
      return;
    }

    const merged = mergeStores(localStore, remoteStore);
    saveStore(userId, merged);
  } catch {
    // Network error — localStorage still works fine
  }
}

/**
 * Push the full local triage store to the server (Blob).
 * Fire-and-forget — call after writes. Does not block UI.
 */
export async function syncToServer(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const store = loadStore(userId);
    await fetch('/api/user/triage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    });
  } catch {
    // Silently fail — localStorage already updated, sync will happen on next action
  }
}

// ---- Read operations ----

export function getTriageState(
  userId: string,
  contextKey: string,
  placeId: string,
): TriageState | 'unreviewed' {
  const store = loadStore(userId);
  const ctx = store[contextKey];
  if (!ctx) return 'unreviewed';
  const entry = ctx.triage[placeId];
  if (!entry) return 'unreviewed';
  return entry.state;
}

export function getTriageEntry(
  userId: string,
  contextKey: string,
  placeId: string,
): TriageEntry | null {
  const store = loadStore(userId);
  const ctx = store[contextKey];
  if (!ctx) return null;
  return ctx.triage[placeId] ?? null;
}

export function getContextCounts(
  userId: string,
  contextKey: string,
): { saved: number; dismissed: number; resurfaced: number } {
  const store = loadStore(userId);
  const ctx = store[contextKey];
  if (!ctx) return { saved: 0, dismissed: 0, resurfaced: 0 };

  let saved = 0, dismissed = 0, resurfaced = 0;
  for (const entry of Object.values(ctx.triage)) {
    if (entry.state === 'saved') saved++;
    else if (entry.state === 'dismissed') dismissed++;
    else if (entry.state === 'resurfaced') resurfaced++;
  }
  return { saved, dismissed, resurfaced };
}

export function getTriagedIds(
  userId: string,
  contextKey: string,
  state: TriageState,
): string[] {
  const store = loadStore(userId);
  const ctx = store[contextKey];
  if (!ctx) return [];
  return Object.entries(ctx.triage)
    .filter(([, entry]) => entry.state === state)
    .map(([id]) => id);
}

// ---- Write operations ----

export function setTriageState(
  userId: string,
  contextKey: string,
  placeId: string,
  state: TriageState,
): void {
  const store = loadStore(userId);
  const ctx = ensureContext(store, contextKey);

  const existing = ctx.triage[placeId];
  ctx.triage[placeId] = {
    state,
    updatedAt: new Date().toISOString(),
    previousState: existing?.state === 'resurfaced' ? existing.previousState : existing?.state,
  };

  saveStore(userId, store);

  // Async fire-and-forget sync to Blob
  syncToServer(userId).catch(() => {/* silently ignore */});

  // When saving, also mark the discovery with savedAt timestamp (#204)
  // This is fire-and-forget to not block the UI
  if (state === 'saved') {
    fetch('/api/user/discoveries/mark-saved', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discoveryId: placeId }),
    }).catch(() => {/* silently ignore — triage state is already persisted */});
  }

  // Notify any listeners that triage changed (e.g. Hot page filters)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('triage-updated', { detail: { placeId, state } }));
  }
}

export function clearTriageState(
  userId: string,
  contextKey: string,
  placeId: string,
): void {
  const store = loadStore(userId);
  const ctx = store[contextKey];
  if (!ctx) return;
  delete ctx.triage[placeId];
  saveStore(userId, store);

  // Async fire-and-forget sync to Blob
  syncToServer(userId).catch(() => {/* silently ignore */});
}

export function toggleTriage(
  userId: string,
  contextKey: string,
  placeId: string,
  action: 'save' | 'dismiss',
): void {
  const current = getTriageState(userId, contextKey, placeId);
  const targetState: TriageState = action === 'save' ? 'saved' : 'dismissed';

  if (current === targetState) {
    // Toggling off — back to unreviewed
    clearTriageState(userId, contextKey, placeId);
  } else {
    setTriageState(userId, contextKey, placeId, targetState);
  }
}

export function markSeen(
  userId: string,
  contextKey: string,
  placeId: string,
  meta: { name: string; city: string; type: DiscoveryType },
): void {
  const store = loadStore(userId);
  const ctx = ensureContext(store, contextKey);

  if (!ctx.seen[placeId]) {
    ctx.seen[placeId] = {
      firstSeen: new Date().toISOString(),
      name: meta.name,
      city: meta.city,
      type: meta.type,
    };
    saveStore(userId, store);
  }
}
