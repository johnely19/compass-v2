/**
 * save_discovery tool — Save a place to a context AND mark it as saved in triage.
 * Use this when the user explicitly asks to save a place (e.g. "save that", "add Legal Sea Foods to my Boston trip").
 * Differs from add_to_compass: also writes triage state = "saved" so it appears in saved list immediately.
 *
 * Issue #204: Uses merge-only writes — saved discoveries are permanent.
 */

import { put, list } from '@vercel/blob';
import { mergeAndWriteDiscoveries, markDiscoverySaved } from '../../discovery-write';
import type { Discovery, DiscoveryType } from '../../types';

export interface SaveDiscoveryInput {
  name: string;
  contextKey: string;       // which context to save to
  city: string;
  type?: DiscoveryType;     // defaults to "restaurant"
  address?: string;
  place_id?: string;
  rating?: number;
  summary?: string;         // Concierge's reason for saving
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

export async function saveDiscovery(userId: string, input: SaveDiscoveryInput): Promise<string> {
  try {
    const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const discovery: Discovery & { savedAt: string } = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: input.city,
      type: input.type || 'restaurant',
      rating: input.rating,
      contextKey: input.contextKey,
      source: 'chat:save',
      discoveredAt: now,
      savedAt: now, // Mark as saved — immutable
      placeIdStatus: input.place_id ? 'verified' : 'missing',
    };

    // 1. Merge-only write to discoveries (never overwrites)
    await mergeAndWriteDiscoveries(userId, [discovery]);

    // 2. Write triage state = saved
    const store = await loadTriageStore(userId);
    if (!store[input.contextKey]) {
      store[input.contextKey] = { triage: {}, seen: {} };
    }
    store[input.contextKey]!.triage[discoveryId] = {
      state: 'saved',
      updatedAt: now,
    };
    if (!store[input.contextKey]!.seen) {
      store[input.contextKey]!.seen = {};
    }
    store[input.contextKey]!.seen![discoveryId] = {
      firstSeen: now,
      name: input.name,
      city: input.city,
      type: input.type || 'restaurant',
    };

    await saveTriageStore(userId, store);

    console.log(`[save_discovery] ✅ Saved "${input.name}" to context "${input.contextKey}" for user ${userId}`);

    const compassUrl = input.place_id
      ? `https://compass-ai-agent.vercel.app/placecards/${input.place_id}`
      : null;

    return `✅ Saved "${input.name}" to ${input.contextKey}${compassUrl ? ` — ${compassUrl}` : ''}`;
  } catch (e) {
    console.error('[save_discovery] Failed:', e);
    return `Failed to save discovery: ${e}`;
  }
}
