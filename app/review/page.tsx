import Link from 'next/link';
import { getCurrentUser } from '../_lib/user';
import { getEffectiveDerivedUserDiscoveries, getEffectiveUserManifest } from '../_lib/effective-user-data';
import { getContextStatus } from '../_lib/context-lifecycle';
import { loadMonitorInventory } from '../_lib/monitor-inventory';
import { getHotSignalLabel, isRecentHotSignal } from '../_lib/hot-intelligence';
import ReviewHubClient from '../_components/ReviewHubClient';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Review</h1>
          <p className="text-muted"><Link href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</Link> to manage your discoveries.</p>
        </div>
      </main>
    );
  }

  const [manifest, discoveriesData, inventory] = await Promise.all([
    getEffectiveUserManifest(user.id),
    getEffectiveDerivedUserDiscoveries(user.id),
    loadMonitorInventory(user.id),
  ]);

  const allContexts = manifest?.contexts ?? [];
  const discoveries = discoveriesData?.discoveries ?? [];

  // Count discoveries per context (server-side) — unreviewed count
  const discoveryCounts: Record<string, number> = {};
  for (const d of discoveries) {
    const key = d.contextKey;
    if (key) discoveryCounts[key] = (discoveryCounts[key] || 0) + 1;
  }

  const contextByKey = new Map(allContexts.map((context) => [context.key, context]));
  const discoveryByPlaceId = new Map<string, { name: string; contextKey: string }>();
  for (const discovery of discoveries) {
    const placeId = discovery.place_id ?? discovery.id;
    if (!placeId || !discovery.contextKey || !discovery.name) continue;
    if (!discoveryByPlaceId.has(placeId)) {
      discoveryByPlaceId.set(placeId, { name: discovery.name, contextKey: discovery.contextKey });
    }
  }

  const signalCounts: Record<string, number> = {};
  const recentSignals: Array<{
    placeId: string;
    contextKey: string;
    contextLabel: string;
    name: string;
    label: string;
    significanceLevel: 'critical' | 'notable' | 'routine' | 'noise';
    lastObservedAt?: string;
  }> = [];

  for (const entry of inventory.entries) {
    const signal = {
      contextKey: entry.contextKey,
      significanceLevel: entry.peakSignificanceLevel,
      significanceSummary: entry.latestSignificanceSummary,
      detectedChanges: entry.detectedChangeKinds,
      lastObservedAt: entry.lastObservedAt,
    };
    if (!isRecentHotSignal(signal) || !entry.contextKey) continue;
    const placeId = entry.place_id ?? entry.id ?? entry.discoveryId;
    if (!placeId) continue;
    const context = contextByKey.get(entry.contextKey);
    const discovery = discoveryByPlaceId.get(placeId);
    if (!context || !discovery) continue;

    signalCounts[entry.contextKey] = (signalCounts[entry.contextKey] || 0) + 1;
    recentSignals.push({
      placeId,
      contextKey: entry.contextKey,
      contextLabel: context.label,
      name: discovery.name,
      label: getHotSignalLabel(signal) ?? 'Fresh signal',
      significanceLevel: signal.significanceLevel ?? 'notable',
      lastObservedAt: signal.lastObservedAt,
    });
  }

  recentSignals.sort((a, b) => {
    const timeA = a.lastObservedAt ? new Date(a.lastObservedAt).getTime() : 0;
    const timeB = b.lastObservedAt ? new Date(b.lastObservedAt).getTime() : 0;
    return timeB - timeA;
  });

  // Active + completed contexts shown in main section
  const activeContexts = allContexts.filter(c => {
    const status = getContextStatus(c);
    return status === 'active' || status === 'completed';
  });

  // Archived contexts shown in separate section
  const archivedContexts = allContexts.filter(c => {
    const status = getContextStatus(c);
    return status === 'archived';
  });

  return (
    <ReviewHubClient
      userId={user.id}
      contexts={activeContexts}
      archivedContexts={archivedContexts}
      discoveryCounts={discoveryCounts}
      signalCounts={signalCounts}
      recentSignals={recentSignals.slice(0, 8)}
    />
  );
}
