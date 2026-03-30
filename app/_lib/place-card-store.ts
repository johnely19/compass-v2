/* ============================================================
   PlaceCardStore — Blob-backed place card data layer.
   Replaces readFileSync('data/placecards/...') calls.
   ============================================================ */

import { put } from '@vercel/blob';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { DiscoveryType } from './types';

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

// ---- Types ----

export interface PlaceCardIndex {
  [placeId: string]: { name: string; type: DiscoveryType };
}

// ---- Store ----

export class PlaceCardStore {
  private static indexCache: PlaceCardIndex | null = null;
  private static indexCacheMs = 0;
  private static readonly INDEX_TTL = 5 * 60 * 1000; // 5 min

  /** Get a single card from Blob. Falls back to local data/ if Blob returns 404. */
  static async getCard(placeId: string): Promise<Record<string, unknown> | null> {
    // Try Blob first
    try {
      const url = `${BLOB_BASE}/place-cards/${placeId}/card.json`;
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (res.ok) return res.json();
    } catch { /* fall through */ }

    // Fall back to local filesystem (during migration period)
    try {
      const localPath = join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
      if (existsSync(localPath)) {
        return JSON.parse(readFileSync(localPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    return null;
  }

  /** Get manifest from Blob. Falls back to local. */
  static async getManifest(placeId: string): Promise<Record<string, unknown> | null> {
    try {
      const url = `${BLOB_BASE}/place-cards/${placeId}/manifest.json`;
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (res.ok) return res.json();
    } catch { /* fall through */ }

    try {
      const localPath = join(process.cwd(), 'data', 'placecards', placeId, 'manifest.json');
      if (existsSync(localPath)) {
        return JSON.parse(readFileSync(localPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    return null;
  }

  /** Get index (cached, with TTL). Falls back to local. */
  static async getIndex(): Promise<PlaceCardIndex> {
    // Memory cache
    if (PlaceCardStore.indexCache && Date.now() - PlaceCardStore.indexCacheMs < PlaceCardStore.INDEX_TTL) {
      return PlaceCardStore.indexCache;
    }

    // Try Blob
    try {
      const url = `${BLOB_BASE}/place-cards/index.json`;
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (res.ok) {
        const idx = await res.json() as PlaceCardIndex;
        PlaceCardStore.indexCache = idx;
        PlaceCardStore.indexCacheMs = Date.now();
        return idx;
      }
    } catch { /* fall through */ }

    // Fall back to local
    try {
      const localPath = join(process.cwd(), 'data', 'placecards', 'index.json');
      if (existsSync(localPath)) {
        const idx = JSON.parse(readFileSync(localPath, 'utf-8')) as PlaceCardIndex;
        PlaceCardStore.indexCache = idx;
        PlaceCardStore.indexCacheMs = Date.now();
        return idx;
      }
    } catch { /* ignore */ }

    return {};
  }

  /** Search cards by name or type using the index. */
  static async searchCards(query: string, type?: string): Promise<Array<{ placeId: string; name: string; type: DiscoveryType }>> {
    const index = await PlaceCardStore.getIndex();
    const q = query.toLowerCase();
    return Object.entries(index)
      .filter(([, v]) => {
        const matchesQuery = !q || v.name.toLowerCase().includes(q);
        const matchesType = !type || v.type === type;
        return matchesQuery && matchesType;
      })
      .map(([placeId, v]) => ({ placeId, name: v.name, type: v.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Write a card to Blob (requires server-side token). */
  static async upsertCard(placeId: string, card: Record<string, unknown>): Promise<void> {
    await put(`place-cards/${placeId}/card.json`, JSON.stringify(card, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    // Invalidate index cache
    PlaceCardStore.indexCache = null;
  }
}
