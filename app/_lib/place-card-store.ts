/* ============================================================
   PlaceCardStore — Filesystem-backed place card data layer.
   Place cards live in data/placecards/{id}/card.json in the
   git repo. Committed, deployed, and served directly from disk.
   No Blob for place cards — edit card.json, commit, deploy done.
   ============================================================ */

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

  /** Get index from filesystem (memory-cached with TTL). */
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

}

