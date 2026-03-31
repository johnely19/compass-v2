/* ============================================================
   PlaceCardStore — Filesystem-only place card data layer.
   Place cards live in data/placecards/{id}/card.json in the
   git repo. Committed, deployed, served directly from disk.
   No Blob for place cards — edit card.json, commit, deploy.
   ============================================================ */

import { put } from '@vercel/blob';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { DiscoveryType } from './types';

// ---- Types ----

export interface PlaceCardIndex {
  [placeId: string]: { name: string; type: DiscoveryType };
}

// ---- Store ----

export class PlaceCardStore {
  private static indexCache: PlaceCardIndex | null = null;
  private static indexCacheMs = 0;
  private static readonly INDEX_TTL = 5 * 60 * 1000; // 5 min

  /** Get a single card from filesystem. */
  static async getCard(placeId: string): Promise<Record<string, unknown> | null> {
    try {
      const localPath = join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
      if (existsSync(localPath)) {
        return JSON.parse(readFileSync(localPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Get manifest from filesystem. */
  static async getManifest(placeId: string): Promise<Record<string, unknown> | null> {
    try {
      const localPath = join(process.cwd(), 'data', 'placecards', placeId, 'manifest.json');
      if (existsSync(localPath)) {
        return JSON.parse(readFileSync(localPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Get index (cached, with TTL) from filesystem. */
  static async getIndex(): Promise<PlaceCardIndex> {
    // Memory cache
    if (PlaceCardStore.indexCache && Date.now() - PlaceCardStore.indexCacheMs < PlaceCardStore.INDEX_TTL) {
      return PlaceCardStore.indexCache;
    }

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

  /** Write user-generated data to Blob (discoveries, triage, chat, etc.).
   *  Place card data is NOT written here — it lives in the git repo.
   *  This method is kept for user data writes only.
   */
  static async putUserData(blobPath: string, data: Record<string, unknown>): Promise<void> {
    await put(blobPath, JSON.stringify(data, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  }
}
