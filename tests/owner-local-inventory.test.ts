import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeDiscoveryInventories, mergeManifestInventories } from '../app/_lib/owner-local-inventory';
import type { Context, Discovery, UserDiscoveries, UserManifest } from '../app/_lib/types';

function manifest(contexts: Context[]): UserManifest {
  return {
    contexts,
    updatedAt: '2026-04-10T12:00:00.000Z',
  };
}

function discoveries(items: Discovery[]): UserDiscoveries {
  return {
    discoveries: items,
    updatedAt: '2026-04-10T12:00:00.000Z',
  };
}

describe('owner-local manifest inventory merge', () => {
  test('includes owner-local contexts that are missing from the primary manifest', () => {
    const merged = mergeManifestInventories(
      manifest([{ key: 'trip:boston-2026', label: 'Boston', emoji: '🦞', type: 'trip', focus: [], active: true }]),
      manifest([{ key: 'trip:nyc-solo-trip', label: 'NYC Solo Trip', emoji: '🗽', type: 'trip', focus: [], active: true }]),
    );

    assert.deepEqual(
      merged?.contexts.map((context) => context.key),
      ['trip:boston-2026', 'trip:nyc-solo-trip'],
    );
  });

  test('keeps the primary version when blob and owner-local share the same key', () => {
    const merged = mergeManifestInventories(
      manifest([{ key: 'trip:nyc-solo-trip', label: 'NYC Solo Trip (blob)', emoji: '🗽', type: 'trip', focus: ['food'], active: true }]),
      manifest([{ key: 'trip:nyc-solo-trip', label: 'NYC Solo Trip (local)', emoji: '🗽', type: 'trip', focus: ['art'], active: true }]),
    );

    assert.equal(merged?.contexts.length, 1);
    assert.equal(merged?.contexts[0]?.label, 'NYC Solo Trip (blob)');
    assert.deepEqual(merged?.contexts[0]?.focus, ['food']);
  });

  test('surfaces owner-local contexts for downstream key lookups', () => {
    const merged = mergeManifestInventories(
      null,
      manifest([{ key: 'trip:nyc-solo-trip', label: 'NYC Solo Trip', emoji: '🗽', type: 'trip', focus: [], active: true }]),
    );

    assert.equal(
      merged?.contexts.findIndex((context) => context.key === 'trip:nyc-solo-trip'),
      0,
    );
  });
});

describe('owner-local discovery inventory merge', () => {
  test('includes owner-local discoveries that are missing from the primary inventory', () => {
    const merged = mergeDiscoveryInventories(
      discoveries([{ id: 'blob-1', name: 'Blob Place', city: 'Boston', type: 'restaurant', contextKey: 'trip:boston-2026', source: 'chat:recommendation', discoveredAt: '2026-04-10T12:00:00.000Z', placeIdStatus: 'verified' }]),
      discoveries([{ id: 'local-1', name: 'Local Place', city: 'New York', type: 'restaurant', contextKey: 'trip:nyc-solo-trip', source: 'local:test', discoveredAt: '2026-04-10T12:00:00.000Z', placeIdStatus: 'verified' }]),
    );

    assert.deepEqual(
      merged?.discoveries.map((discovery) => discovery.id),
      ['blob-1', 'local-1'],
    );
  });

  test('dedupes owner-local discoveries when the primary inventory already has the same id', () => {
    const merged = mergeDiscoveryInventories(
      discoveries([{ id: 'shared-1', name: 'Blob Place', city: 'Boston', type: 'restaurant', contextKey: 'trip:boston-2026', source: 'chat:recommendation', discoveredAt: '2026-04-10T12:00:00.000Z', placeIdStatus: 'verified' }]),
      discoveries([{ id: 'shared-1', name: 'Local Place', city: 'New York', type: 'restaurant', contextKey: 'trip:nyc-solo-trip', source: 'local:test', discoveredAt: '2026-04-10T12:00:00.000Z', placeIdStatus: 'verified' }]),
    );

    assert.equal(merged?.discoveries.length, 1);
    assert.equal(merged?.discoveries[0]?.name, 'Blob Place');
  });
});
