import { deriveDiscoveryInventory } from './discovery-history';
import { mergeDiscoveryInventories, mergeManifestInventories, readOwnerLocalDiscoveries, readOwnerLocalManifest } from './owner-local-inventory';
import type { UserDiscoveries, UserManifest } from './types';
import { getUserById } from './user';
import { getUserDiscoveries, getUserManifest } from './user-data';

function shouldUseOwnerLocalInventory(userId: string): boolean {
  return Boolean(getUserById(userId)?.isOwner);
}

export async function getEffectiveUserManifest(userId: string): Promise<UserManifest | null> {
  const manifest = await getUserManifest(userId);
  if (!shouldUseOwnerLocalInventory(userId)) return manifest;
  return mergeManifestInventories(manifest, readOwnerLocalManifest());
}

export async function getWritableUserManifest(userId: string): Promise<UserManifest> {
  return (await getEffectiveUserManifest(userId)) ?? {
    contexts: [],
    updatedAt: '',
  };
}

export async function getEffectiveUserDiscoveries(userId: string): Promise<UserDiscoveries | null> {
  const discoveries = await getUserDiscoveries(userId);
  if (!shouldUseOwnerLocalInventory(userId)) return discoveries;
  return mergeDiscoveryInventories(discoveries, readOwnerLocalDiscoveries());
}

export async function getEffectiveDerivedUserDiscoveries(userId: string, historyLimit = 50): Promise<UserDiscoveries | null> {
  const current = await getEffectiveUserDiscoveries(userId);
  const discoveries = await deriveDiscoveryInventory({
    userId,
    currentDiscoveries: current?.discoveries ?? [],
    historyLimit,
  });

  if (!current && discoveries.length === 0) return null;

  return {
    discoveries,
    updatedAt: current?.updatedAt ?? new Date().toISOString(),
  };
}
