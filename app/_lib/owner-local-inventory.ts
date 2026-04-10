import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Discovery, UserDiscoveries, UserManifest } from './types';

export function readOwnerLocalManifest(): UserManifest | null {
  const manifestPath = path.join(process.cwd(), 'data', 'compass-manifest.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      contexts?: UserManifest['contexts'];
      updatedAt?: string;
    };
    return {
      contexts: raw.contexts ?? [],
      updatedAt: raw.updatedAt ?? '',
    };
  } catch {
    return null;
  }
}

export function readOwnerLocalDiscoveries(): UserDiscoveries | null {
  const discoveriesPath = path.join(process.cwd(), 'data', 'local-discoveries.json');
  if (!existsSync(discoveriesPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(discoveriesPath, 'utf8')) as Discovery[] | UserDiscoveries;
    if (Array.isArray(raw)) {
      return {
        discoveries: raw,
        updatedAt: '',
      };
    }
    return {
      discoveries: raw.discoveries ?? [],
      updatedAt: raw.updatedAt ?? '',
    };
  } catch {
    return null;
  }
}

export function mergeManifestInventories(
  primary: UserManifest | null,
  ownerLocal: UserManifest | null,
): UserManifest | null {
  if (!primary && !ownerLocal) return null;

  const primaryContexts = (primary?.contexts ?? []).map((context) => ({ ...context }));
  const ownerLocalContexts = ownerLocal?.contexts ?? [];
  const primaryKeys = new Set(primaryContexts.map((context) => context.key));

  return {
    contexts: [
      ...primaryContexts,
      ...ownerLocalContexts
        .filter((context) => !primaryKeys.has(context.key))
        .map((context) => ({ ...context })),
    ],
    updatedAt: primary?.updatedAt || ownerLocal?.updatedAt || '',
  };
}

export function mergeDiscoveryInventories(
  primary: UserDiscoveries | null,
  ownerLocal: UserDiscoveries | null,
): UserDiscoveries | null {
  if (!primary && !ownerLocal) return null;

  const primaryDiscoveries = (primary?.discoveries ?? []).map((discovery) => ({ ...discovery }));
  const ownerLocalDiscoveries = ownerLocal?.discoveries ?? [];
  const primaryIds = new Set(primaryDiscoveries.map((discovery) => discovery.id));

  return {
    discoveries: [
      ...primaryDiscoveries,
      ...ownerLocalDiscoveries
        .filter((discovery) => !primaryIds.has(discovery.id))
        .map((discovery) => ({ ...discovery })),
    ],
    updatedAt: primary?.updatedAt || ownerLocal?.updatedAt || '',
  };
}
