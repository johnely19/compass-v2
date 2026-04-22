import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHotSignalMap } from '../app/_lib/hot-intelligence.ts';
import type { MonitorEntry } from '../app/_lib/monitor-inventory.ts';

function makeEntry(overrides: Partial<MonitorEntry>): MonitorEntry {
  return {
    id: overrides.id ?? 'entry-1',
    place_id: overrides.place_id,
    discoveryId: overrides.discoveryId ?? 'disc-1',
    name: overrides.name ?? 'Signal Place',
    city: overrides.city ?? 'Toronto',
    address: overrides.address,
    type: overrides.type ?? 'restaurant',
    contextKey: overrides.contextKey ?? 'radar:toronto',
    monitorStatus: overrides.monitorStatus ?? 'active',
    monitorType: overrides.monitorType ?? 'hospitality',
    monitorReasons: overrides.monitorReasons ?? ['volatile'],
    monitorDimensions: overrides.monitorDimensions ?? [],
    firstPromotedAt: overrides.firstPromotedAt ?? '2026-04-01T10:00:00.000Z',
    lastUpdatedAt: overrides.lastUpdatedAt ?? '2026-04-01T10:00:00.000Z',
    lastObservedAt: overrides.lastObservedAt,
    nextCheckAt: overrides.nextCheckAt,
    baselineState: overrides.baselineState,
    currentState: overrides.currentState,
    observations: overrides.observations ?? [],
    detectedChangeKinds: overrides.detectedChangeKinds ?? ['rating-up'],
    peakSignificanceLevel: overrides.peakSignificanceLevel,
    peakSignificanceScore: overrides.peakSignificanceScore,
    latestSignificanceSummary: overrides.latestSignificanceSummary,
    hasCriticalChange: overrides.hasCriticalChange,
  };
}

describe('buildHotSignalMap', () => {
  test('keeps the strongest signal for a place id', () => {
    const map = buildHotSignalMap([
      makeEntry({
        id: 'older-notable',
        place_id: 'abc',
        discoveryId: 'd1',
        peakSignificanceLevel: 'notable',
        lastObservedAt: '2026-04-20T10:00:00.000Z',
        latestSignificanceSummary: 'Rating slipped',
      }),
      makeEntry({
        id: 'newer-critical',
        place_id: 'abc',
        discoveryId: 'd2',
        peakSignificanceLevel: 'critical',
        lastObservedAt: '2026-04-21T10:00:00.000Z',
        latestSignificanceSummary: 'Closure reported',
      }),
    ]);

    assert.equal(map.get('abc')?.significanceLevel, 'critical');
    assert.equal(map.get('abc')?.significanceSummary, 'Closure reported');
  });

  test('skips routine-only monitoring noise for hot signals', () => {
    const map = buildHotSignalMap([
      makeEntry({
        id: 'routine',
        place_id: 'xyz',
        discoveryId: 'd3',
        peakSignificanceLevel: 'routine',
        lastObservedAt: '2026-04-21T10:00:00.000Z',
      }),
    ]);

    assert.equal(map.has('xyz'), false);
  });
});
