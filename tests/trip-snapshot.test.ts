/**
 * Run: ../../../compass-v2/node_modules/.bin/tsx --test tests/trip-snapshot.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTripSnapshotItems } from '../app/_lib/chat/trip-snapshot';

test('buildTripSnapshotItems creates durable trip snapshot items in display order', () => {
  const items = buildTripSnapshotItems(
    {
      city: 'Boston',
      dates: 'April 27-30, 2026',
      focus: ['food', 'architecture', 'food'],
      emoji: '🦞',
    },
    [{ field: 'dates', value: 'April 27-30, 2026', icon: '📅', label: 'Dates' }]
  );

  assert.deepEqual(items, [
    { field: 'city', label: 'Destination', icon: '📍', value: 'Boston', highlighted: false },
    { field: 'dates', label: 'Dates', icon: '📅', value: 'April 27-30, 2026', highlighted: true },
    { field: 'focus', label: 'Focus', icon: '🏷️', value: 'food, architecture', highlighted: false },
    { field: 'emoji', label: 'Mood', icon: '✨', value: '🦞', highlighted: false },
  ]);
});

test('buildTripSnapshotItems omits empty values and highlights matching recent fields', () => {
  const items = buildTripSnapshotItems(
    {
      city: '  ',
      focus: [' jazz ', ''],
      emoji: '🎷',
    },
    [{ field: 'emoji', value: '🎷', icon: '✨', label: 'Mood' }]
  );

  assert.deepEqual(items, [
    { field: 'focus', label: 'Focus', icon: '🏷️', value: 'jazz', highlighted: false },
    { field: 'emoji', label: 'Mood', icon: '✨', value: '🎷', highlighted: true },
  ]);
});
