import { list, put } from '@vercel/blob';
import type { Discovery } from './types';

const BLOB_PREFIX = 'users';
const DISCOVERY_HISTORY_VERSION = 1;

export interface DiscoveryHistoryRemovedItem {
  key: string;
  id?: string;
  place_id?: string;
  name: string;
  contextKey: string;
}

export interface DiscoveryHistoryEvent {
  version: number;
  eventId: string;
  userId: string;
  recordedAt: string;
  source: string;
  previousCount: number;
  nextCount: number;
  added: Discovery[];
  updated: Discovery[];
  removed: DiscoveryHistoryRemovedItem[];
  contextKeys: string[];
}

export interface DiscoveryObservation {
  recordedAt: string;
  source: string;
  change: 'added' | 'updated';
  discovery: Discovery;
}

function historyPrefix(userId: string): string {
  return `${BLOB_PREFIX}/${userId}/discovery-history/`;
}

function safeSourceSegment(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'write';
}

function normalizeName(name: string | undefined): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export function getDiscoveryHistoryKey(discovery: Partial<Discovery>): string {
  if (discovery.id) return `id:${discovery.id}`;
  if (discovery.place_id && discovery.contextKey) return `place:${discovery.place_id}:${discovery.contextKey}`;
  return `name:${normalizeName(discovery.name)}:${discovery.contextKey || ''}`;
}

export function getDiscoveryInventoryKey(discovery: Partial<Discovery>): string {
  if (discovery.place_id && discovery.contextKey) return `place:${discovery.place_id}:${discovery.contextKey}`;
  if (discovery.name && discovery.contextKey) return `name:${normalizeName(discovery.name)}:${discovery.contextKey}`;
  if (discovery.id) return `id:${discovery.id}`;
  return getDiscoveryHistoryKey(discovery);
}

function toRemovedItem(discovery: Discovery): DiscoveryHistoryRemovedItem {
  return {
    key: getDiscoveryHistoryKey(discovery),
    id: discovery.id,
    place_id: discovery.place_id,
    name: discovery.name,
    contextKey: discovery.contextKey,
  };
}

function isSameDiscovery(a: Discovery, b: Discovery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffDiscoveries(previous: Discovery[], next: Discovery[]) {
  const previousByKey = new Map(previous.map((d) => [getDiscoveryHistoryKey(d), d]));
  const nextByKey = new Map(next.map((d) => [getDiscoveryHistoryKey(d), d]));

  const added: Discovery[] = [];
  const updated: Discovery[] = [];
  const removed: DiscoveryHistoryRemovedItem[] = [];

  for (const [key, discovery] of nextByKey) {
    const existing = previousByKey.get(key);
    if (!existing) {
      added.push(discovery);
      continue;
    }
    if (!isSameDiscovery(existing, discovery)) {
      updated.push(discovery);
    }
  }

  for (const [key, discovery] of previousByKey) {
    if (!nextByKey.has(key)) {
      removed.push(toRemovedItem(discovery));
    }
  }

  return { added, updated, removed };
}

export async function recordDiscoveryHistoryEvent(params: {
  userId: string;
  source: string;
  previous: Discovery[];
  next: Discovery[];
}): Promise<DiscoveryHistoryEvent | null> {
  const { userId, source, previous, next } = params;
  const { added, updated, removed } = diffDiscoveries(previous, next);

  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    return null;
  }

  const recordedAt = new Date().toISOString();
  const stamp = Date.now();
  const eventId = `dhe_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
  const event: DiscoveryHistoryEvent = {
    version: DISCOVERY_HISTORY_VERSION,
    eventId,
    userId,
    recordedAt,
    source,
    previousCount: previous.length,
    nextCount: next.length,
    added,
    updated,
    removed,
    contextKeys: Array.from(new Set([...added, ...updated].map((d) => d.contextKey).filter(Boolean))).sort(),
  };

  const blobPath = `${historyPrefix(userId)}${stamp}-${safeSourceSegment(source)}.json`;
  await put(blobPath, JSON.stringify(event, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return event;
}

export async function listRecentDiscoveryHistory(userId: string, limit = 20): Promise<DiscoveryHistoryEvent[]> {
  const { blobs } = await list({ prefix: historyPrefix(userId), limit: Math.max(limit, 20) });
  const sorted = [...blobs].sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(0, limit);

  const events = await Promise.all(sorted.map(async (blob) => {
    try {
      const res = await fetch(blob.url, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as DiscoveryHistoryEvent;
    } catch {
      return null;
    }
  }));

  return events.filter((event): event is DiscoveryHistoryEvent => Boolean(event));
}

export async function getRecentDiscoveryObservations(
  userId: string,
  options: {
    placeId?: string;
    name?: string;
    contextKey?: string;
    limit?: number;
    historyLimit?: number;
  } = {},
): Promise<DiscoveryObservation[]> {
  const { placeId, name, contextKey, limit = 10, historyLimit = 20 } = options;
  const normalizedName = normalizeName(name);
  const events = await listRecentDiscoveryHistory(userId, historyLimit);
  const observations: DiscoveryObservation[] = [];

  for (const event of events) {
    for (const change of ['added', 'updated'] as const) {
      for (const discovery of event[change]) {
        if (placeId && discovery.place_id !== placeId) continue;
        if (contextKey && discovery.contextKey !== contextKey) continue;
        if (normalizedName && normalizeName(discovery.name) !== normalizedName) continue;
        observations.push({
          recordedAt: event.recordedAt,
          source: event.source,
          change,
          discovery,
        });
        if (observations.length >= limit) {
          return observations;
        }
      }
    }
  }

  return observations;
}

function discoveryRecency(discovery: Partial<Discovery>, fallbackTimestamp?: string): number {
  const timestamp = discovery.discoveredAt || fallbackTimestamp;
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function mergeLatestDiscovery(
  latestByKey: Map<string, Discovery>,
  discovery: Discovery,
  options: { preserveExisting?: boolean } = {},
): void {
  const key = getDiscoveryInventoryKey(discovery);
  const existing = latestByKey.get(key);

  if (!existing) {
    latestByKey.set(key, discovery);
    return;
  }

  if (options.preserveExisting) {
    return;
  }

  if (discoveryRecency(discovery) >= discoveryRecency(existing)) {
    latestByKey.set(key, discovery);
  }
}

export async function deriveDiscoveryInventory(params: {
  userId: string;
  currentDiscoveries?: Discovery[];
  historyLimit?: number;
}): Promise<Discovery[]> {
  const { userId, currentDiscoveries = [], historyLimit = 50 } = params;
  const latestByKey = new Map<string, Discovery>();

  for (const discovery of currentDiscoveries) {
    mergeLatestDiscovery(latestByKey, discovery);
  }

  const events = await listRecentDiscoveryHistory(userId, historyLimit);
  for (const event of events) {
    for (const discovery of [...event.updated, ...event.added]) {
      mergeLatestDiscovery(latestByKey, discovery, { preserveExisting: true });
    }
  }

  return Array.from(latestByKey.values()).sort((a, b) =>
    discoveryRecency(b) - discoveryRecency(a),
  );
}

export async function deriveDiscoveryQueueFromHistory(userId: string, historyLimit = 50): Promise<Discovery[]> {
  return deriveDiscoveryInventory({ userId, historyLimit });
}
