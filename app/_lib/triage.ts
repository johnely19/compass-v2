/* ============================================================
   Compass v2 — Triage System (localStorage)
   Single source of truth: compass-triage-{userId}
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
