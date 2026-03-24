/* ============================================================
   Compass v2 — User Data Layer (Vercel Blob)
   Per-user documents: users/{userId}/{docType}.json
   ============================================================ */

import { put, list, del } from '@vercel/blob';
import type { UserDocType, UserDocMap, UserProfile, UserPreferences, UserManifest, UserDiscoveries, UserChat } from './types';

const BLOB_PREFIX = 'users';

// ---- Generic read/write ----

export async function getUserData<T extends UserDocType>(
  userId: string,
  docType: T,
): Promise<UserDocMap[T] | null> {
  const blobPath = `${BLOB_PREFIX}/${userId}/${docType}.json`;

  try {
    // List blobs matching this path
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) return null;

    const res = await fetch(blob.url);
    if (!res.ok) return null;

    return (await res.json()) as UserDocMap[T];
  } catch {
    return null;
  }
}

export async function setUserData<T extends UserDocType>(
  userId: string,
  docType: T,
  data: UserDocMap[T],
): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${userId}/${docType}.json`;

  // Delete existing blob at this path (if any)
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) {
      await del(existing.url);
    }
  } catch {
    // Ignore delete errors
  }

  await put(blobPath, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

// ---- Convenience methods ----

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  return getUserData(userId, 'profile');
}

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  return getUserData(userId, 'preferences');
}

export async function getUserManifest(userId: string): Promise<UserManifest | null> {
  const raw = await getUserData(userId, 'manifest');
  if (!raw) return null;
  
  // V1→V2 compatibility: map "section" contexts to "radar" type
  if (raw.contexts) {
    raw.contexts = raw.contexts.map(ctx => {
      let key = ctx.key;
      let type = ctx.type;
      // Map V1 "section" type to V2 "radar"
      if ((type as string) === 'section' || key?.startsWith('section:')) {
        type = 'radar';
        key = key.replace(/^section:/, 'radar:');
      }
      // Ensure type exists
      if (!type) {
        if (key?.startsWith('trip:')) type = 'trip';
        else if (key?.startsWith('outing:')) type = 'outing';
        else type = 'radar';
      }
      return {
        ...ctx,
        key,
        type,
        emoji: ctx.emoji || '📋',
      };
    });
  }
  return raw;
}

const VALID_DISCOVERY_TYPES = new Set([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

function inferTypeFromName(name: string | undefined | null): string {
  if (!name) return 'restaurant';
  const lower = name.toLowerCase();
  if (/gallery|art\s/.test(lower)) return 'gallery';
  if (/museum/.test(lower)) return 'museum';
  if (/bar|wine|cocktail|brewery|pub\b/.test(lower)) return 'bar';
  if (/caf[eé]|coffee|bakery/.test(lower)) return 'cafe';
  if (/theatre|theater/.test(lower)) return 'theatre';
  if (/park|garden/.test(lower)) return 'park';
  if (/hotel|inn\b/.test(lower)) return 'hotel';
  if (/market|grocer|butcher/.test(lower)) return 'grocery';
  if (/shop|store|book/.test(lower)) return 'shop';
  return 'restaurant';
}

function normalizeContextKey(key: string | undefined | null): string {
  if (!key || key === 'undefined' || !key.includes(':')) return 'radar:toronto-experiences';
  let k = key;
  if (k.startsWith('section:')) k = k.replace(/^section:/, 'radar:');
  // Strip user prefix (e.g. "john:outing:..." → "outing:...")
  if (!k.startsWith('trip:') && !k.startsWith('outing:') && !k.startsWith('radar:')) {
    const m = k.match(/^[a-z0-9]+:(trip:|outing:|radar:|section:)(.*)/);
    if (m && m[1] && m[2]) k = m[1] + m[2];
    if (k.startsWith('section:')) k = k.replace(/^section:/, 'radar:');
  }
  if (!k.includes(':')) return 'radar:toronto-experiences';
  return k;
}

export async function getUserDiscoveries(userId: string): Promise<UserDiscoveries | null> {
  const raw = await getUserData(userId, 'discoveries');
  if (!raw) return null;

  // V1→V2 compatibility: V1 stores as raw array, V2 expects { discoveries: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAny = raw as any;
  const rawArray: Array<Record<string, unknown>> = Array.isArray(rawAny)
    ? rawAny
    : Array.isArray(rawAny?.discoveries)
      ? rawAny.discoveries
      : [];

  // Normalize all fields for V1→V2 compatibility
  const normalized = rawArray.map((d, i) => ({
    ...d,
    id: (d.id as string) || `v1_${i}`,
    name: (d.name as string) || 'Unknown Place',
    city: (d.city as string) || 'Toronto',
    type: (d.type as string) && VALID_DISCOVERY_TYPES.has(d.type as string)
      ? d.type
      : inferTypeFromName(d.name as string),
    rating: d.rating != null ? Number(d.rating) || undefined : undefined,
    contextKey: normalizeContextKey(d.contextKey as string),
    discoveredAt: (d.discoveredAt as string) || new Date().toISOString(),
    placeIdStatus: (d.placeIdStatus as string) || (d.place_id ? 'verified' : 'missing'),
    source: (d.source as string) || 'v1:migrated',
  }));

  return { discoveries: normalized, updatedAt: new Date().toISOString() } as unknown as UserDiscoveries;
}

export async function getUserChat(userId: string): Promise<UserChat | null> {
  return getUserData(userId, 'chat');
}
