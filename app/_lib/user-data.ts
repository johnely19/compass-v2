/* ============================================================
   Compass v2 — User Data Layer (Vercel Blob)
   Per-user documents: users/{userId}/{docType}.json
   ============================================================ */

import { put, list, del } from '@vercel/blob';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { Discovery, UserDocType, UserDocMap, UserProfile, UserPreferences, UserManifest, UserDiscoveries, UserChat } from './types';
import { deriveDiscoveryInventory, recordDiscoveryHistoryEvent } from './discovery-history';

// Place card index cache (server-side only)
let _placeCardIndex: Record<string, { name: string; type: string }> | null = null;
function getPlaceCardIndex() {
  if (_placeCardIndex) return _placeCardIndex;
  try {
    const p = path.join(process.cwd(), 'data', 'placecards', 'index.json');
    if (existsSync(p)) {
      _placeCardIndex = JSON.parse(readFileSync(p, 'utf8'));
      return _placeCardIndex!;
    }
  } catch { /* ignore */ }
  return {};
}

/** Look up authoritative type from place card index for a given place_id */
function lookupTypeFromIndex(placeId: string | undefined | null): string | null {
  if (!placeId || typeof window !== 'undefined') return null;
  const index = getPlaceCardIndex();
  return (index[placeId] as { type?: string } | undefined)?.type || null;
}

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
    if (!blob) {
      // Filesystem fixture fallback — used when Blob is unavailable (CI, local dev without token)
      return readUserFixture<T>(userId, docType);
    }

    const res = await fetch(blob.url);
    if (!res.ok) return readUserFixture<T>(userId, docType);

    try {
      return (await res.json()) as UserDocMap[T];
    } catch {
      // Blob content is not valid JSON (e.g. stale 404 HTML) — fall back to fixture
      return readUserFixture<T>(userId, docType);
    }
  } catch {
    // Blob unavailable (no token, network error) — fall back to fixture
    return readUserFixture<T>(userId, docType);
  }
}

/**
 * Read static fixture data for a user from data/user-fixtures/{userId}/{docType}.json.
 * Used as a fallback when Vercel Blob is unavailable (CI, local dev without token).
 */
function readUserFixture<T extends UserDocType>(userId: string, docType: T): UserDocMap[T] | null {
  try {
    const fixturePath = path.join(process.cwd(), 'data', 'user-fixtures', userId, `${docType}.json`);
    if (!existsSync(fixturePath)) return null;
    return JSON.parse(readFileSync(fixturePath, 'utf8')) as UserDocMap[T];
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
  let previousDiscoveries: UserDiscoveries | null = null;

  // Snapshot current document before overwrite for recovery/audit.
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) {
      const res = await fetch(existing.url);
      if (res.ok) {
        const existingText = await res.text();
        if (docType === 'discoveries') {
          try {
            const parsed = JSON.parse(existingText) as UserDiscoveries | Discovery[];
            previousDiscoveries = Array.isArray(parsed)
              ? { discoveries: parsed, updatedAt: new Date().toISOString() }
              : parsed;
          } catch {
            previousDiscoveries = null;
          }
        }
        const snapshotPath = `${BLOB_PREFIX}/${userId}/history/${docType}-${Date.now()}.json`;
        await put(snapshotPath, existingText, {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
        });
      }
      await del(existing.url);
    }
  } catch {
    // Ignore snapshot/delete errors
  }

  await put(blobPath, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  if (docType === 'discoveries') {
    try {
      const nextDiscoveries = (data as UserDiscoveries).discoveries ?? [];
      await recordDiscoveryHistoryEvent({
        userId,
        source: 'user-data:set',
        previous: previousDiscoveries?.discoveries ?? [],
        next: nextDiscoveries,
      });
    } catch {
      // best-effort history only
    }
  }
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

/** Map non-standard V1 types to valid V2 types */
const TYPE_NORMALIZATION: Record<string, string> = {
  'event': 'experience',
  'live-music': 'music-venue',
  'live_music': 'music-venue',
  'live_music_venue': 'music-venue',
  'live_music_bar': 'music-venue',
  'live music': 'music-venue',
  'live music venue': 'music-venue',
  'venue': 'music-venue',
  'comedy': 'theatre',
  'exhibition': 'gallery',
  'art_gallery': 'gallery',
  'art_museum': 'museum',
  'wine-bar': 'bar',
  'wine_bar': 'bar',
  'cocktail-bar': 'bar',
  'cocktail_bar': 'bar',
  'brewery': 'bar',
  'pub': 'bar',
  'bakery': 'cafe',
  'butcher': 'grocery',
  'cheese-shop': 'grocery',
  'grocery_store': 'grocery',
  'specialty-shop': 'shop',
  'bookstore': 'shop',
  'bookshop': 'shop',
  'book_store': 'shop',
  'street_art': 'gallery',
  'outdoor': 'park',
  'hiking trail': 'park',
  'hiking_trail': 'park',
  'culture': 'experience',
  'note': 'experience',
};

function normalizeType(type: string | undefined | null): string {
  if (!type) return 'restaurant';
  const normalized = type.toLowerCase().trim().replace(/\s+/g, '_');
  if (VALID_DISCOVERY_TYPES.has(normalized)) return normalized;
  const mapped = TYPE_NORMALIZATION[normalized];
  if (mapped) return mapped;
  if (normalized.endsWith('_restaurant')) return 'restaurant';
  if (normalized.endsWith('_gallery')) return 'gallery';
  if (normalized.endsWith('_museum')) return 'museum';
  if (normalized.endsWith('_park')) return 'park';
  if (normalized.endsWith('_bar') || normalized.endsWith('_pub')) return 'bar';
  if (normalized.endsWith('_bakery') || normalized.endsWith('_cafe') || normalized.endsWith('_coffee_shop')) return 'cafe';
  if (normalized.endsWith('_store') || normalized.endsWith('_shop')) return 'shop';
  return 'restaurant'; // ultimate fallback
}

function inferTypeFromName(name: string | undefined | null): string {
  if (!name) return 'restaurant';
  const lower = name.toLowerCase();
  if (/gallery|art\s|fine art/.test(lower)) return 'gallery';
  if (/museum|biennial/.test(lower)) return 'museum';
  if (/cinema|nitehawk|film house|movie|theater(?!.*food)/.test(lower)) return 'experience';
  if (/concert hall|symphony|philharmonic/.test(lower)) return 'music-venue';
  if (/roller.*arts|roller.*rink|skating/.test(lower)) return 'experience';
  if (/house of yes|live nation|music.*hall|jazz.*club|nublu|rex\b|the rex/.test(lower)) return 'music-venue';
  if (/bar|wine|cocktail|brewery|pub\b/.test(lower)) return 'bar';
  if (/caf[eé]|coffee|bakery/.test(lower)) return 'cafe';
  if (/theatre|comedy|improv/.test(lower)) return 'theatre';
  if (/park|garden/.test(lower)) return 'park';
  if (/hotel|inn\b/.test(lower)) return 'hotel';
  if (/market|grocer|butcher/.test(lower)) return 'grocery';
  if (/shop|store|book/.test(lower)) return 'shop';
  return 'restaurant';
}

function normalizeContextKey(key: string | undefined | null): string {
  if (!key || key === 'undefined') return '';
  if (!key.includes(':')) return '';
  let k = key;
  // Map known non-standard prefixes
  if (k.startsWith('home:')) return '';
  if (k.startsWith('section:')) k = k.replace(/^section:/, 'radar:');
  // Strip user prefix (e.g. "john:outing:..." → "outing:...")
  if (!k.startsWith('trip:') && !k.startsWith('outing:') && !k.startsWith('radar:')) {
    const m = k.match(/^[a-z0-9]+:(trip:|outing:|radar:|section:)(.*)/);
    if (m && m[1] && m[2]) k = m[1] + m[2];
    if (k.startsWith('section:')) k = k.replace(/^section:/, 'radar:');
  }
  if (!k.includes(':')) return '';
  return k;
}

function normalizeCityCandidate(city: string | undefined | null): string {
  if (!city) return '';
  return city
    .replace(/^\d{4,6}\s+/, '')
    .replace(/\s+[A-Z]{2}\s+[A-Z0-9 -]+$/i, '')
    .replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i, '')
    .trim();
}

function inferCityFromAddress(address: string | undefined | null): string {
  if (!address) return '';

  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  let candidate = '';
  if (parts.length >= 4) {
    candidate = parts[parts.length - 3] || '';
  } else if (parts.length === 3) {
    const middle = parts[1] || '';
    const tail = parts[2] || '';
    const middleLooksLikeStreet = /^\d/.test(middle) || /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pl|place|square)\b/i.test(middle);
    const tailLooksLikeCountry = /^(usa|canada|france|uk|united kingdom)$/i.test(tail);
    candidate = middleLooksLikeStreet ? tail : (tailLooksLikeCountry ? middle : middle || tail);
  } else if (parts.length >= 2) {
    candidate = parts[1] || '';
  }

  const cleaned = normalizeCityCandidate(candidate);
  if (!cleaned) return '';
  if (/^(usa|canada|france|uk|united kingdom|ontario|quebec|ny|on|qc)$/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function inferCityFromContext(contextKey: string | undefined | null): string {
  const key = (contextKey || '').toLowerCase();
  if (!key) return '';
  if (key.includes('brooklyn')) return 'Brooklyn';
  if (key.includes('nyc') || key.includes('new-york') || key.includes('manhattan')) return 'New York';
  if (key.includes('toronto')) return 'Toronto';
  if (key.includes('paris')) return 'Paris';
  if (key.includes('montreal')) return 'Montreal';
  if (key.includes('boston')) return 'Boston';
  return '';
}

function normalizeCity(params: {
  city?: string | null;
  address?: string | null;
  contextKey?: string | null;
}): string {
  const normalizedContextKey = normalizeContextKey(params.contextKey);
  const normalizedCity = normalizeCityCandidate(params.city);
  const inferredFromAddress = inferCityFromAddress(params.address);
  const inferredFromContext = inferCityFromContext(normalizedContextKey);

  if (!normalizedCity) {
    return inferredFromAddress || inferredFromContext || '';
  }

  if (/^toronto$/i.test(normalizedCity) && inferredFromContext && !/^toronto$/i.test(inferredFromContext)) {
    return inferredFromAddress || inferredFromContext;
  }

  return normalizedCity;
}

function inferContextKey(contextKey: string | undefined | null, city: string | undefined | null): string {
  const normalized = normalizeContextKey(contextKey);
  if (normalized) return normalized;
  const normalizedCity = normalizeCityCandidate(city);
  if (!normalizedCity) return '';
  const slug = normalizedCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `radar:${slug}` : '';
}

function normalizeDiscoveryKey(discovery: Pick<Discovery, 'place_id' | 'contextKey' | 'name'>): string {
  if (discovery.place_id && discovery.contextKey) return `place:${discovery.place_id}:${discovery.contextKey}`;
  const normalizedName = (discovery.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return `name:${normalizedName}:${discovery.contextKey || ''}`;
}

function discoveryCompletenessScore(discovery: Partial<Discovery>): number {
  return [
    discovery.place_id,
    discovery.address,
    discovery.city,
    discovery.heroImage,
    discovery.source,
    discovery.description,
    discovery.rating,
    discovery.match,
  ].filter((value) => value !== undefined && value !== null && value !== '').length;
}

function mergeDiscoveryRecords(existing: Discovery, incoming: Discovery): Discovery {
  const existingTime = Date.parse(existing.discoveredAt || '') || 0;
  const incomingTime = Date.parse(incoming.discoveredAt || '') || 0;
  const preferred = incomingTime >= existingTime ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;

  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    name: preferred.name !== 'Unknown Place' ? preferred.name : fallback.name,
    address: preferred.address || fallback.address,
    city: preferred.city || fallback.city,
    type: preferred.type !== 'restaurant' || !fallback.type ? preferred.type : fallback.type,
    heroImage: preferred.heroImage || fallback.heroImage,
    rating: preferred.rating ?? fallback.rating,
    match: preferred.match ?? fallback.match,
    source: preferred.source !== 'v1:migrated' ? preferred.source : fallback.source,
    discoveredAt: existingTime >= incomingTime ? existing.discoveredAt : incoming.discoveredAt,
  };
}

function dedupeDiscoveries(discoveries: Discovery[]): Discovery[] {
  const deduped = new Map<string, Discovery>();

  for (const discovery of discoveries) {
    const key = normalizeDiscoveryKey(discovery);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, discovery);
      continue;
    }

    const merged = mergeDiscoveryRecords(existing, discovery);
    const existingScore = discoveryCompletenessScore(existing);
    const incomingScore = discoveryCompletenessScore(discovery);
    deduped.set(key, incomingScore >= existingScore ? merged : mergeDiscoveryRecords(discovery, existing));
  }

  return Array.from(deduped.values());
}

export function normalizeUserDiscoveries(raw: UserDiscoveries | Discovery[]): UserDiscoveries {
  // V1→V2 compatibility: V1 stores as raw array, V2 expects { discoveries: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAny = raw as any;
  const rawArray: Array<Record<string, unknown>> = Array.isArray(rawAny)
    ? rawAny
    : Array.isArray(rawAny?.discoveries)
      ? rawAny.discoveries
      : [];

  // Normalize all fields for V1→V2 compatibility
  const normalized = rawArray.map((d, i) => {
    const city = normalizeCity({
      city: d.city as string | null | undefined,
      address: d.address as string | null | undefined,
      contextKey: d.contextKey as string | null | undefined,
    });

    return {
      ...d,
      id: (d.id as string) || `v1_${i}`,
      name: (d.name as string) || 'Unknown Place',
      city,
      type: (() => {
        // Priority: authoritative type from place card index (for cards with place_id)
        const placeId = d.place_id as string | undefined;
        const indexed = lookupTypeFromIndex(placeId);
        if (indexed && VALID_DISCOVERY_TYPES.has(indexed)) return indexed;
        // Fallback: normalize incoming type or infer from name
        if (d.type) return normalizeType(d.type as string);
        return inferTypeFromName(d.name as string);
      })(),
      rating: d.rating != null ? Number(d.rating) || undefined : undefined,
      contextKey: inferContextKey(d.contextKey as string | null | undefined, city),
      discoveredAt: (d.discoveredAt as string) || new Date().toISOString(),
      placeIdStatus: (d.placeIdStatus as string) || (d.place_id ? 'verified' : 'missing'),
      source: (d.source as string) || 'v1:migrated',
    };
  }) as Discovery[];

  return {
    discoveries: dedupeDiscoveries(normalized),
    updatedAt: !Array.isArray(rawAny) && typeof rawAny?.updatedAt === 'string'
      ? rawAny.updatedAt
      : new Date().toISOString(),
  } as UserDiscoveries;
}

export async function getUserDiscoveries(userId: string): Promise<UserDiscoveries | null> {
  const raw = await getUserData(userId, 'discoveries');
  if (!raw) return null;
  return normalizeUserDiscoveries(raw as UserDiscoveries | Discovery[]);
}

export async function getDerivedUserDiscoveries(userId: string, historyLimit = 50): Promise<UserDiscoveries | null> {
  const current = await getUserDiscoveries(userId);
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

export async function getUserChat(userId: string): Promise<UserChat | null> {
  return getUserData(userId, 'chat');
}
