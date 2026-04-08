/**
 * remove_discovery tool — Remove/dismiss a discovery from a context.
 * Called by Concierge when the user wants to remove a place.
 *
 * Examples:
 * - "Remove that museum"
 * - "Take out Legal Sea Foods"
 * - "Drop the hotel, keep the restaurants"
 */

import { put, list } from '@vercel/blob';
import { getUserData, setUserData } from '../../user-data';
import type { Discovery, UserDiscoveries } from '../../types';

export interface RemoveDiscoveryInput {
  /** Name of the discovery to remove (fuzzy-matched) */
  name: string;
  /** Context key to search within */
  contextKey: string;
}

const BLOB_PREFIX = 'users';

type TriageEntry = { state: string; updatedAt: string; previousState?: string };
type ContextTriage = { triage: Record<string, TriageEntry>; seen?: Record<string, unknown> };
type TriageStore = Record<string, ContextTriage>;

function triageBlobPath(userId: string) {
  return `${BLOB_PREFIX}/${userId}/triage.json`;
}

async function loadTriageStore(userId: string): Promise<TriageStore> {
  try {
    const { blobs } = await list({ prefix: triageBlobPath(userId) });
    if (!blobs[0]) return {};
    const res = await fetch(blobs[0].url);
    if (!res.ok) return {};
    return (await res.json()) as TriageStore;
  } catch {
    return {};
  }
}

async function saveTriageStore(userId: string, store: TriageStore): Promise<void> {
  await put(triageBlobPath(userId), JSON.stringify(store), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

/**
 * Find discovery by name in context (fuzzy).
 */
function findDiscoveryByName(
  discoveries: Discovery[],
  name: string,
  contextKey: string,
): number {
  const nameLower = name.toLowerCase().trim();

  // Exact match within context
  const exactIdx = discoveries.findIndex(
    d => d.contextKey === contextKey && d.name.toLowerCase() === nameLower,
  );
  if (exactIdx !== -1) return exactIdx;

  // Partial match within context
  const partialIdx = discoveries.findIndex(
    d => d.contextKey === contextKey && (
      d.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(d.name.toLowerCase())
    ),
  );
  if (partialIdx !== -1) return partialIdx;

  // Global fallback
  return discoveries.findIndex(d => d.name.toLowerCase() === nameLower);
}

export async function removeDiscovery(
  userId: string,
  input: RemoveDiscoveryInput,
): Promise<string> {
  try {
    let discData: UserDiscoveries | null = null;
    try {
      discData = await getUserData<'discoveries'>(userId, 'discoveries');
    } catch {
      return '❌ No discoveries found. Nothing to remove.';
    }

    if (!discData?.discoveries?.length) {
      return '❌ No discoveries found. Nothing to remove.';
    }

    const idx = findDiscoveryByName(discData.discoveries, input.name, input.contextKey);
    if (idx === -1) {
      const inContext = discData.discoveries
        .filter(d => d.contextKey === input.contextKey)
        .map(d => d.name)
        .slice(0, 5);
      const hint = inContext.length > 0
        ? ` Available: ${inContext.join(', ')}`
        : ' No discoveries in this context.';
      return `❌ Could not find "${input.name}" to remove.${hint}`;
    }

    const discovery = discData.discoveries[idx]!;
    const removedName = discovery.name;
    const removedId = discovery.id;

    // Remove from discoveries array
    discData.discoveries.splice(idx, 1);
    discData.updatedAt = new Date().toISOString();
    await setUserData(userId, 'discoveries', discData);

    // Mark as dismissed in triage store
    try {
      const store = await loadTriageStore(userId);
      if (!store[input.contextKey]) {
        store[input.contextKey] = { triage: {}, seen: {} };
      }
      const existing = store[input.contextKey]!.triage[removedId];
      store[input.contextKey]!.triage[removedId] = {
        state: 'dismissed',
        updatedAt: new Date().toISOString(),
        previousState: existing?.state || undefined,
      };
      await saveTriageStore(userId, store);
    } catch (e) {
      // Triage update is best-effort
      console.warn('[remove_discovery] Triage update failed (non-critical):', e);
    }

    console.log(`[remove_discovery] ✅ Removed "${removedName}" from ${input.contextKey} for user ${userId}`);
    return `✅ Removed "${removedName}" from your Compass.`;
  } catch (e) {
    console.error('[remove_discovery] Failed:', e);
    return `Failed to remove discovery: ${e}`;
  }
}
