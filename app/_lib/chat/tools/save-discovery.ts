/**
 * save_discovery tool — Save a place to a context AND mark it as saved in triage.
 * Use this when the user explicitly asks to save a place (e.g. "save that", "add Legal Sea Foods to my Boston trip").
 * Differs from add_to_compass: also writes triage state = "saved" so it appears in saved list immediately.
 */

import { put, list } from '@vercel/blob';
import { getUserData, setUserData } from '../../user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../types';
import { resolveCity } from './resolve-city';

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
  const { blobs } = await list({ prefix: triageBlobPath(userId) });
  if (blobs[0]) {
    // Overwrite by re-putting with same path
  }
  await put(triageBlobPath(userId), JSON.stringify(store), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

export async function saveDiscovery(userId: string, input: SaveDiscoveryInput): Promise<string> {
  try {
    const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Derive city from actual place data, not from LLM context (fixes #187)
    const resolvedCity = await resolveCity(input.place_id, input.address, input.city);

    const discovery: Discovery = {
      id: discoveryId,
      place_id: input.place_id,
      name: input.name,
      address: input.address,
      city: resolvedCity,
      type: input.type || 'restaurant',
      rating: input.rating,
      contextKey: input.contextKey,
      source: 'chat:save',
      discoveredAt: new Date().toISOString(),
      placeIdStatus: input.place_id ? 'verified' : 'missing',
    };

    // 1. Write to discoveries
    let discData: UserDiscoveries | null = null;
    try {
      discData = await getUserData<'discoveries'>(userId, 'discoveries');
    } catch { /* none yet */ }

    const discoveries = discData?.discoveries || [];
    discoveries.unshift(discovery);
    await setUserData(userId, 'discoveries', {
      discoveries,
      updatedAt: new Date().toISOString(),
    });

    // 2. Write triage state = saved
    const store = await loadTriageStore(userId);
    if (!store[input.contextKey]) {
      store[input.contextKey] = { triage: {}, seen: {} };
    }
    store[input.contextKey]!.triage[discoveryId] = {
      state: 'saved',
      updatedAt: new Date().toISOString(),
    };
    if (!store[input.contextKey]!.seen) {
      store[input.contextKey]!.seen = {};
    }
    store[input.contextKey]!.seen![discoveryId] = {
      firstSeen: new Date().toISOString(),
      name: input.name,
      city: resolvedCity,
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
