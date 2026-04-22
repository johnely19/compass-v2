import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { getManifestHeroImage } from '../_lib/image-url.server';
import { loadMonitorInventory } from '../_lib/monitor-inventory';
import type { MonitorChangeKind } from '../_lib/monitor-inventory';
import { buildHotSignalMap } from '../_lib/hot-intelligence';
import HotClient from './HotClient';

export const dynamic = 'force-dynamic';

interface IndexEntry {
  name: string;
  type: DiscoveryType;
}

interface CardData {
  built?: string | null;
  identity?: {
    city?: string | null;
  };
  narrative?: {
    summary?: string | null;
  };
}

function loadIndex(): Record<string, IndexEntry> {
  const indexPath = path.join(process.cwd(), 'data', 'placecards', 'index.json');
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, IndexEntry>;
  } catch {
    return {};
  }
}

function loadCardData(placeId: string): CardData {
  const cardPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
  if (!existsSync(cardPath)) return {};
  try {
    return JSON.parse(readFileSync(cardPath, 'utf8')) as CardData;
  } catch {
    return {};
  }
}

// Check if a card is a "new opening" based on summary content
function isNewOpening(summary: string | null): boolean {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  // Use specific phrases only — avoid false positives like "New York" or "new to the area"
  return (
    lower.includes('just opened') ||
    lower.includes('soft-opened') ||
    lower.includes('soft open') ||
    lower.includes('now open') ||
    lower.includes('opening soon') ||
    lower.includes('grand opening') ||
    /opened\s+(in\s+)?(march|april|may|june|july|august|2026)/.test(lower) ||
    /new\s+(restaurant|bar|café|cafe|spot|opening|location|arrival)/.test(lower)
  );
}

interface HotPlaceCard {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  isNewOpening: boolean;
  addedAt: string | null;
  heroImage: string | null;
  monitorStatus?: string;
  contextKey?: string;
  significanceLevel?: 'critical' | 'notable' | 'routine' | 'noise';
  significanceSummary?: string;
  detectedChanges?: MonitorChangeKind[];
  lastObservedAt?: string;
  hasRecentSignal: boolean;
}

export default async function HotPage() {
  const user = await getCurrentUser();

  // Hot page uses the global place card index — owner only
  if (!user?.isOwner) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🔥 What&apos;s Hot</h1>
        </div>
        <p className="text-muted">Coming soon.</p>
      </main>
    );
  }

  const [inventory, index] = await Promise.all([
    loadMonitorInventory(user.id),
    Promise.resolve(loadIndex()),
  ]);
  const signalById = buildHotSignalMap(inventory.entries);

  const nowTime = new Date().getTime();

  // Build enriched card data with city, new opening detection, and date
  const cards: HotPlaceCard[] = Object.entries(index).map(([placeId, entry]) => {
    const cardData = loadCardData(placeId);
    const city = cardData.identity?.city ?? '';
    const summary = cardData.narrative?.summary ?? null;
    const isNew = isNewOpening(summary);
    // Use built date as the date signal for sorting (when card was created)
    const addedAt = cardData.built ?? null;

    const heroImage = getManifestHeroImage(placeId);
    const signal = signalById.get(placeId);
    const signalObservedAt = signal?.lastObservedAt ? new Date(signal.lastObservedAt).getTime() : 0;
    const hasRecentSignal = Boolean(
      signal?.significanceLevel &&
        signalObservedAt > 0 &&
        nowTime - signalObservedAt <= 7 * 24 * 60 * 60 * 1000,
    );

    return {
      placeId,
      name: entry.name,
      type: entry.type,
      city,
      isNewOpening: isNew,
      addedAt,
      heroImage,
      monitorStatus: signal?.monitorStatus,
      contextKey: signal?.contextKey,
      significanceLevel: signal?.significanceLevel,
      significanceSummary: signal?.significanceSummary,
      detectedChanges: signal?.detectedChanges,
      lastObservedAt: signal?.lastObservedAt,
      hasRecentSignal,
    };
  });

  // Get available types from the data
  const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  return <HotClient cards={cards} availableTypes={availableTypes} userId={user?.id} />;
}
