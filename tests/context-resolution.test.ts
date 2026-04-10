import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContextAliases, resolveContextReference, type KnownContextDiscovery } from '../app/_lib/chat/context-resolution';
import type { UserManifest } from '../app/_lib/types';

const manifest: UserManifest = {
  updatedAt: '2026-04-10T00:00:00.000Z',
  contexts: [
    {
      key: 'trip:cottage-july-2026',
      label: 'Ontario Cottage',
      emoji: '🏊',
      type: 'trip',
      city: 'Lake Huron',
      dates: 'July 2026 (3+ weeks)',
      focus: ['waterfront', 'swimming'],
      active: true,
    },
    {
      key: 'trip:nyc-solo-trip',
      label: 'NYC Solo Trip',
      emoji: '🗽',
      type: 'trip',
      city: 'New York',
      dates: '2026-04-27 to 2026-04-30',
      focus: ['galleries', 'jazz'],
      active: true,
      accommodation: {
        name: "Arnold's",
        address: '126 Leonard St',
      },
    } as UserManifest['contexts'][number],
  ],
};

const discoveries: KnownContextDiscovery[] = [
  {
    contextKey: 'trip:cottage-july-2026',
    name: 'The Lookout',
    type: 'accommodation',
    city: 'Port Albert',
    address: 'Port Albert',
    discoveredAt: '2026-03-15T00:00:00.000Z',
  },
];

test('buildContextAliases derives semantic cues from label, city, and saved places', () => {
  const aliases = buildContextAliases(manifest.contexts[0]!, discoveries, 8);
  assert.deepEqual(
    aliases.slice(0, 6),
    ['Ontario Cottage', 'Ontario Cottage trip', 'Lake Huron', 'Lake Huron cottage trip', 'Lake Huron trip', 'cottage trip'],
  );
  assert.match(aliases.join(' | '), /The Lookout trip/);
});

test('resolveContextReference matches natural regional phrasing', () => {
  const resolved = resolveContextReference('What about the Lake Huron cottage trip?', manifest, discoveries);
  assert.equal(resolved?.context.key, 'trip:cottage-july-2026');
  assert.ok((resolved?.matchedAliases || []).includes('Lake Huron cottage trip'));
});

test('resolveContextReference matches saved-place phrasing', () => {
  const resolved = resolveContextReference('Switch to The Lookout trip', manifest, discoveries);
  assert.equal(resolved?.context.key, 'trip:cottage-july-2026');
});

test('resolveContextReference stays conservative on vague references', () => {
  const resolved = resolveContextReference('What about the trip?', manifest, discoveries);
  assert.equal(resolved, null);
});
