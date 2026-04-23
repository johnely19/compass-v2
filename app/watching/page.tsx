import { getCurrentUser } from '../_lib/user';
import { getUserManifest, getUserDiscoveries } from '../_lib/user-data';
import type { Context, Discovery } from '../_lib/types';
import { isContextActive } from '../_lib/context-lifecycle';
import { annotateDiscoveriesForMonitoring } from '../_lib/discovery-monitoring';
import { loadMonitorInventory } from '../_lib/monitor-inventory';
import { buildHotSignalMap, getHotSignalLabel, isRecentHotSignal } from '../_lib/hot-intelligence';
import type { SignificanceLevel } from '../_lib/observation-significance';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { UserManifest } from '../_lib/types';
import WatchingClient from './WatchingClient';

export const dynamic = 'force-dynamic';

function loadLocalManifest(): UserManifest | null {
  const p = path.join(process.cwd(), 'data', 'compass-manifest.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return { contexts: raw.contexts ?? [], updatedAt: raw.updatedAt ?? '' };
  } catch { return null; }
}

function loadLocalDiscoveries(): Discovery[] {
  const p = path.join(process.cwd(), 'data', 'local-discoveries.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return (Array.isArray(raw) ? raw : (raw.discoveries ?? [])) as Discovery[];
  } catch { return []; }
}

export interface WatchItem {
  id: string;
  placeId?: string;
  name: string;
  city: string;
  type: string;
  contextKey: string;
  contextLabel: string;
  monitorStatus: string;
  monitorType: string;
  monitorCadence?: string;
  monitorExplanation?: string;
  monitorDimensions?: Array<{ key: string; label: string; description: string }>;
  monitorSources?: Array<{ key: string; label: string; rationale: string }>;
  monitorLastObservedAt?: string;
  monitorNextCheckAt?: string;
  dueNow: boolean;
  /** Significance from observation history */
  significanceLevel?: SignificanceLevel;
  significanceScore?: number;
  significanceSummary?: string;
  hasCriticalChange?: boolean;
  observationCount?: number;
  /** Source of the latest notable/critical observation ('google-places' | 'web-search' | 'manual') */
  latestSignificantSource?: string;
  signalLabel?: string;
  hasRecentSignal?: boolean;
}

export default async function WatchingPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Watching</h1>
          <p>Sign in to see your monitoring queue.</p>
        </div>
      </main>
    );
  }

  const [blobManifest, discoveriesData] = await Promise.all([
    getUserManifest(user.id),
    getUserDiscoveries(user.id),
  ]);

  const blobContexts = blobManifest?.contexts ?? [];
  const localContexts = user.isOwner ? (loadLocalManifest()?.contexts ?? []) : [];
  const blobKeys = new Set(blobContexts.map(c => c.key));
  const mergedContexts = [
    ...blobContexts,
    ...localContexts.filter(c => !blobKeys.has(c.key)),
  ];
  const contexts: Context[] = mergedContexts.filter(c => isContextActive(c));

  const blobDiscoveries = discoveriesData?.discoveries ?? [];
  const localDisc = user.isOwner ? loadLocalDiscoveries() : [];
  const blobIds = new Set(blobDiscoveries.map(d => d.id));
  const allDiscoveries = [
    ...blobDiscoveries,
    ...localDisc.filter(d => !blobIds.has(d.id)),
  ];

  const fullyBuilt = allDiscoveries.filter(
    d => d.name && (d.address || d.description || d.rating)
  );

  const contextByKey = new Map(contexts.map(c => [c.key, c]));

  const [annotated, inventory] = await Promise.all([
    annotateDiscoveriesForMonitoring({
      userId: user.id,
      discoveries: fullyBuilt,
      contexts,
    }),
    loadMonitorInventory(user.id),
  ]);

  const signalById = buildHotSignalMap(inventory.entries);

  // Index inventory entries by id and discoveryId for quick lookup
  const inventoryById = new Map(
    inventory.entries.flatMap(e => [
      [e.id, e],
      [e.discoveryId, e],
    ]),
  );

  const watchItems: WatchItem[] = annotated
    .filter(d => d.monitorStatus && d.monitorStatus !== 'none')
    .map(d => {
      const ctx = contextByKey.get(d.contextKey);
      const inventoryEntry = inventoryById.get(d.place_id ?? d.id) ?? inventoryById.get(d.id);
      const signal = signalById.get(d.place_id ?? d.id) ?? signalById.get(d.id);
      return {
        id: d.id,
        placeId: d.place_id,
        name: d.name,
        city: d.city,
        type: d.type,
        contextKey: d.contextKey,
        contextLabel: ctx?.label ?? d.contextKey,
        // Prefer durable inventory status (may have been escalated by significance)
        monitorStatus: inventoryEntry?.monitorStatus ?? d.monitorStatus ?? 'candidate',
        monitorType: d.monitorType ?? 'general',
        monitorCadence: d.monitorCadence,
        monitorExplanation: d.monitorExplanation,
        monitorDimensions: d.monitorDimensions,
        monitorSources: d.monitorSources,
        monitorLastObservedAt: d.monitorLastObservedAt,
        monitorNextCheckAt: d.monitorNextCheckAt,
        dueNow: Boolean(d.monitorDueNow),
        // Significance from durable inventory
        significanceLevel: inventoryEntry?.peakSignificanceLevel,
        significanceScore: inventoryEntry?.peakSignificanceScore,
        significanceSummary: inventoryEntry?.latestSignificanceSummary,
        hasCriticalChange: inventoryEntry?.hasCriticalChange,
        observationCount: inventoryEntry?.observations?.length ?? 0,
        // Source of the latest observation that had notable/critical significance
        latestSignificantSource: inventoryEntry?.observations?.find(
          o => o.significanceLevel === 'critical' || o.significanceLevel === 'notable'
        )?.source,
        signalLabel: signal ? getHotSignalLabel(signal) ?? undefined : undefined,
        hasRecentSignal: signal ? isRecentHotSignal(signal) : false,
      };
    })
    .sort((a, b) => {
      if (a.dueNow !== b.dueNow) return a.dueNow ? -1 : 1;
      const rank: Record<string, number> = { priority: 0, active: 1, candidate: 2 };
      const statusDiff = (rank[a.monitorStatus] ?? 9) - (rank[b.monitorStatus] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      // Within same status group: sort by significance score descending (highest significance first)
      return (b.significanceScore ?? 0) - (a.significanceScore ?? 0);
    });

  return <WatchingClient items={watchItems} />;
}
