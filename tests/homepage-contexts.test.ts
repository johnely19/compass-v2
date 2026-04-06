import test from 'node:test';
import assert from 'node:assert/strict';

import type { Context, Discovery } from '../app/_lib/types';
import { getHomepageContextVisibility } from '../app/_lib/homepage-contexts';

function makeContext(key: string, label: string): Context {
  return {
    key,
    label,
    emoji: '🧭',
    type: 'radar',
    focus: [],
    active: true,
  };
}

function makeDiscovery(id: string, contextKey: string): Discovery {
  return {
    id,
    name: id,
    city: 'Toronto',
    type: 'restaurant',
    contextKey,
    source: 'test',
    discoveredAt: '2026-04-05T00:00:00.000Z',
    placeIdStatus: 'verified',
  };
}

test('keeps homepage order while hiding contexts with zero discoveries', () => {
  const contexts = [
    makeContext('trip:cottage-july-2026', 'Ontario Cottage'),
    makeContext('radar:developments', 'Developments'),
    makeContext('radar:toronto-experiences', 'Toronto Experiences'),
  ];

  const discoveryBuckets = new Map<string, Discovery[]>([
    ['trip:cottage-july-2026', []],
    ['radar:developments', []],
    ['radar:toronto-experiences', [makeDiscovery('toronto-experiences-1', 'radar:toronto-experiences')]],
  ]);

  const result = getHomepageContextVisibility({ contexts, discoveryBuckets });

  assert.deepEqual(
    result.visibleContexts.map((context) => context.key),
    ['radar:toronto-experiences'],
  );
  assert.equal(result.hiddenEmptyContextCount, 2);
});

test('reports when every active homepage context is hidden', () => {
  const contexts = [
    makeContext('trip:cottage-july-2026', 'Ontario Cottage'),
    makeContext('radar:developments', 'Developments'),
  ];

  const result = getHomepageContextVisibility({
    contexts,
    discoveryBuckets: {
      'trip:cottage-july-2026': [],
      'radar:developments': [],
    },
  });

  assert.deepEqual(result.visibleContexts, []);
  assert.equal(result.hiddenEmptyContextCount, 2);
});
