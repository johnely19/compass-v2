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

export async function getUserDiscoveries(userId: string): Promise<UserDiscoveries | null> {
  const raw = await getUserData(userId, 'discoveries');
  if (!raw) return null;

  // V1→V2 compatibility: normalize contextKeys
  if (raw.discoveries && Array.isArray(raw.discoveries)) {
    raw.discoveries = raw.discoveries.map(d => {
      let contextKey = d.contextKey;
      if (typeof contextKey === 'string') {
        // Map section: → radar:
        if (contextKey.startsWith('section:')) {
          contextKey = contextKey.replace(/^section:/, 'radar:');
        }
        // Strip user prefix (e.g. "john:outing:..." → "outing:...")
        const prefixMatch = contextKey.match(/^[a-z0-9]+:(trip:|outing:|radar:)/);
        if (prefixMatch && !contextKey.startsWith('trip:') && !contextKey.startsWith('outing:') && !contextKey.startsWith('radar:')) {
          contextKey = contextKey.replace(/^[a-z0-9]+:/, '');
        }
      }
      // Default fallback for invalid contextKeys
      if (!contextKey || contextKey === 'undefined' || !contextKey.includes(':')) {
        contextKey = 'radar:toronto-experiences';
      }
      return { ...d, contextKey };
    });
  }
  return raw;
}

export async function getUserChat(userId: string): Promise<UserChat | null> {
  return getUserData(userId, 'chat');
}
