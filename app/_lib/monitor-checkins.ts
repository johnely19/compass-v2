/**
 * Monitor Check-ins
 *
 * Persists per-user check-in records in Blob at:
 *   users/{userId}/monitor-checkins.json
 *
 * Each check-in advances the monitoring timer for a discovery,
 * resetting monitorLastObservedAt so the cadence restarts from now.
 */

import { list, put } from '@vercel/blob';

const BLOB_PREFIX = 'users';

export interface MonitorCheckin {
  /** ISO timestamp of when the check-in was recorded */
  checkedAt: string;
  /** Optional note from the user */
  note?: string;
}

/**
 * Key format mirrors getDiscoveryHistoryKey:
 *   "id:{id}"        when discovery id is known
 *   "place:{placeId}:{contextKey}"  when placeId + contextKey known
 *   "name:{normalized}:{contextKey}"  fallback
 */
export type MonitorCheckinStore = Record<string, MonitorCheckin[]>;

function checkinBlobPath(userId: string): string {
  return `${BLOB_PREFIX}/${userId}/monitor-checkins.json`;
}

export async function loadCheckinStore(userId: string): Promise<MonitorCheckinStore> {
  try {
    const { blobs } = await list({ prefix: checkinBlobPath(userId), limit: 1 });
    const blob = blobs[0];
    if (!blob) return {};
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as MonitorCheckinStore;
  } catch {
    return {};
  }
}

export async function saveCheckinStore(userId: string, store: MonitorCheckinStore): Promise<void> {
  await put(checkinBlobPath(userId), JSON.stringify(store, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

export async function recordCheckin(params: {
  userId: string;
  discoveryKey: string;
  note?: string;
}): Promise<MonitorCheckin> {
  const { userId, discoveryKey, note } = params;
  const store = await loadCheckinStore(userId);
  const checkin: MonitorCheckin = {
    checkedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  const existing = store[discoveryKey] ?? [];
  // Keep at most 20 checkins per discovery (most recent first)
  store[discoveryKey] = [checkin, ...existing].slice(0, 20);
  await saveCheckinStore(userId, store);
  return checkin;
}

/** Return the most recent check-in timestamp for a given key, if any */
export function getLatestCheckinAt(
  store: MonitorCheckinStore,
  discoveryKey: string,
): string | undefined {
  return store[discoveryKey]?.[0]?.checkedAt;
}
