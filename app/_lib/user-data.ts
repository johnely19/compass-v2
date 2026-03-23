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
  return getUserData(userId, 'manifest');
}

export async function getUserDiscoveries(userId: string): Promise<UserDiscoveries | null> {
  return getUserData(userId, 'discoveries');
}

export async function getUserChat(userId: string): Promise<UserChat | null> {
  return getUserData(userId, 'chat');
}
