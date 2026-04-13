/**
 * Tests for observation-runner helpers
 *
 * Run: npx tsx app/_lib/observation-runner.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectWebEnrichmentCandidates, baseIntervalMs, computeNextCheckAt } from './observation-runner';
import type { MonitorEntry, MonitorObservation, ObservedState } from './monitor-inventory';

function makeObservedState(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    observedAt: new Date().toISOString(),
    source: 'google-places',
    rating: 4.5,
    reviewCount: 100,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<MonitorObservation> = {}): MonitorObservation {
  return {
    observedAt: new Date().toISOString(),
    source: 'google-places',
    changes: [],
    state: makeObservedState(),
    significanceLevel: 'routine',
    significanceScore: 10,
    significanceSummary: 'Routine check',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<MonitorEntry> = {}): MonitorEntry {
  return {
    id: `entry-${Math.random()}`,
    discoveryId: `disc-${Math.random()}`,
    name: 'Test Place',
    city: 'Test City',
    contextKey: 'test-context',
    type: 'restaurant',
    monitorStatus: 'candidate',
    monitorType: 'hospitality',
    monitorReasons: [],
    monitorDimensions: [],
    firstPromotedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    observations: [],
    detectedChangeKinds: [],
    ...overrides,
  };
}

describe('selectWebEnrichmentCandidates', () => {
  it('returns empty for empty input', () => {
    const result = selectWebEnrichmentCandidates([], 3);
    assert.deepStrictEqual(result, []);
  });

  it('filters entries without place_id', () => {
    const entries = [
      makeEntry({ id: '1', place_id: 'place1' }),
      makeEntry({ id: '2', place_id: undefined }),
      makeEntry({ id: '3', place_id: 'place3' }),
    ];
    const result = selectWebEnrichmentCandidates(entries, 3);
    assert.ok(result.includes('1'));
    assert.ok(result.includes('3'));
    assert.ok(!result.includes('2'));
  });

  it('prioritizes priority status entries', () => {
    const entries = [
      makeEntry({ id: 'candidate', monitorStatus: 'candidate', place_id: 'place-candidate' }),
      makeEntry({ id: 'priority', monitorStatus: 'priority', place_id: 'place-priority' }),
      makeEntry({ id: 'active', monitorStatus: 'active', place_id: 'place-active' }),
    ];
    const result = selectWebEnrichmentCandidates(entries, 2);
    assert.strictEqual(result[0], 'priority');
  });

  it('sorts by significance score within same status', () => {
    const entries = [
      makeEntry({ id: 'low', monitorStatus: 'active', place_id: 'place-low', observations: [makeObservation({ significanceScore: 10 })] }),
      makeEntry({ id: 'high', monitorStatus: 'active', place_id: 'place-high', observations: [makeObservation({ significanceScore: 90 })] }),
    ];
    const result = selectWebEnrichmentCandidates(entries, 2);
    assert.strictEqual(result[0], 'high');
  });

  it('respects the limit', () => {
    const entries = [
      makeEntry({ id: '1', place_id: 'p1', monitorStatus: 'priority' }),
      makeEntry({ id: '2', place_id: 'p2', monitorStatus: 'active' }),
      makeEntry({ id: '3', place_id: 'p3', monitorStatus: 'candidate' }),
      makeEntry({ id: '4', place_id: 'p4', monitorStatus: 'candidate' }),
    ];
    const result = selectWebEnrichmentCandidates(entries, 2);
    assert.strictEqual(result.length, 2);
  });
});

describe('baseIntervalMs', () => {
  it('returns 7 days for hospitality', () => {
    assert.strictEqual(baseIntervalMs('hospitality'), 7 * 24 * 60 * 60 * 1000);
  });

  it('returns 14 days for stay', () => {
    assert.strictEqual(baseIntervalMs('stay'), 14 * 24 * 60 * 60 * 1000);
  });

  it('returns 14 days for development', () => {
    assert.strictEqual(baseIntervalMs('development'), 14 * 24 * 60 * 60 * 1000);
  });

  it('returns 14 days for culture', () => {
    assert.strictEqual(baseIntervalMs('culture'), 14 * 24 * 60 * 60 * 1000);
  });

  it('returns 14 days for general (default)', () => {
    assert.strictEqual(baseIntervalMs('general'), 14 * 24 * 60 * 60 * 1000);
    assert.strictEqual(baseIntervalMs('unknown'), 14 * 24 * 60 * 60 * 1000);
  });
});

describe('computeNextCheckAt', () => {
  it('uses 2 days for critical significance', () => {
    const entry = makeEntry({
      monitorType: 'hospitality',
      observations: [makeObservation({ significanceLevel: 'critical' })],
    });
    const observedAt = new Date().toISOString();
    const result = computeNextCheckAt(entry, observedAt);
    const expectedMs = new Date(observedAt).getTime() + 2 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(new Date(result).getTime() - expectedMs) < 1000);
  });

  it('uses 5 days for notable significance', () => {
    const entry = makeEntry({
      monitorType: 'hospitality',
      observations: [makeObservation({ significanceLevel: 'notable' })],
    });
    const observedAt = new Date().toISOString();
    const result = computeNextCheckAt(entry, observedAt);
    const expectedMs = new Date(observedAt).getTime() + 5 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(new Date(result).getTime() - expectedMs) < 1000);
  });

  it('halves interval for priority status', () => {
    const entry = makeEntry({
      monitorType: 'hospitality',
      monitorStatus: 'priority',
      observations: [makeObservation({ significanceLevel: 'routine' })],
    });
    const observedAt = new Date().toISOString();
    const result = computeNextCheckAt(entry, observedAt);
    // hospitality base is 7 days, halved = 3.5 days
    const expectedMs = new Date(observedAt).getTime() + Math.floor(7 * 24 * 60 * 60 * 1000 * 0.5);
    assert.ok(Math.abs(new Date(result).getTime() - expectedMs) < 1000);
  });

  it('uses base interval for routine significance', () => {
    const entry = makeEntry({
      monitorType: 'stay', // 14 days
      monitorStatus: 'active',
      observations: [makeObservation({ significanceLevel: 'routine' })],
    });
    const observedAt = new Date().toISOString();
    const result = computeNextCheckAt(entry, observedAt);
    const expectedMs = new Date(observedAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(new Date(result).getTime() - expectedMs) < 1000);
  });
});