import type { MonitorEntry, MonitorChangeKind } from './monitor-inventory';
import type { SignificanceLevel } from './observation-significance';

export interface HotCardSignal {
  monitorStatus?: string;
  contextKey?: string;
  significanceLevel?: SignificanceLevel;
  significanceSummary?: string;
  detectedChanges?: MonitorChangeKind[];
  lastObservedAt?: string;
}

const SIGNIFICANCE_RANK: Record<SignificanceLevel, number> = {
  critical: 3,
  notable: 2,
  routine: 1,
  noise: 0,
};

export function buildHotSignalMap(entries: MonitorEntry[]): Map<string, HotCardSignal> {
  const map = new Map<string, HotCardSignal>();

  for (const entry of entries) {
    const level = entry.peakSignificanceLevel;
    if (!level || SIGNIFICANCE_RANK[level] < SIGNIFICANCE_RANK.notable) continue;

    const signal: HotCardSignal = {
      monitorStatus: entry.monitorStatus,
      contextKey: entry.contextKey,
      significanceLevel: level,
      significanceSummary: entry.latestSignificanceSummary,
      detectedChanges: entry.detectedChangeKinds,
      lastObservedAt: entry.lastObservedAt,
    };

    const keys = [entry.place_id, entry.id, entry.discoveryId].filter(Boolean) as string[];
    for (const key of keys) {
      const existing = map.get(key);
      if (!existing || compareSignals(signal, existing) < 0) {
        map.set(key, signal);
      }
    }
  }

  return map;
}

export function compareSignals(a: HotCardSignal, b: HotCardSignal): number {
  const levelDiff = (SIGNIFICANCE_RANK[b.significanceLevel ?? 'noise'] ?? 0) - (SIGNIFICANCE_RANK[a.significanceLevel ?? 'noise'] ?? 0);
  if (levelDiff !== 0) return levelDiff;

  const aTime = a.lastObservedAt ? new Date(a.lastObservedAt).getTime() : 0;
  const bTime = b.lastObservedAt ? new Date(b.lastObservedAt).getTime() : 0;
  return bTime - aTime;
}

export function isRecentHotSignal(signal: HotCardSignal, maxAgeHours = 168): boolean {
  if (!signal.significanceLevel || !signal.lastObservedAt) return false;
  if (SIGNIFICANCE_RANK[signal.significanceLevel] < SIGNIFICANCE_RANK.notable) return false;
  const ageMs = Date.now() - new Date(signal.lastObservedAt).getTime();
  return ageMs <= maxAgeHours * 60 * 60 * 1000;
}
