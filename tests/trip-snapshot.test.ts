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
      purpose: 'Long weekend for food and architecture',
      people: [{ name: 'John' }, { name: 'Huzur' }, { name: 'John' }],
      emoji: '🦞',
    },
    [{ field: 'dates', value: 'April 27-30, 2026', icon: '📅', label: 'Dates' }]
  );

  assert.deepEqual(items, [
    { field: 'city', label: 'Destination', icon: '📍', value: 'Boston', highlighted: false },
    { field: 'dates', label: 'Dates', icon: '📅', value: 'April 27-30, 2026', highlighted: true },
    { field: 'focus', label: 'Focus', icon: '🏷️', value: 'food, architecture', highlighted: false },
    { field: 'purpose', label: 'Purpose', icon: '🎯', value: 'Long weekend for food and architecture', highlighted: false },
    { field: 'people', label: 'People', icon: '👥', value: 'John, Huzur', highlighted: false },
    { field: 'emoji', label: 'Mood', icon: '✨', value: '🦞', highlighted: false },
  ]);
});

test('buildTripSnapshotItems omits empty values and highlights matching recent fields', () => {
  const items = buildTripSnapshotItems(
    {
      city: '  ',
      focus: [' jazz ', ''],
      people: [{ name: 'Dessa' }],
      emoji: '🎷',
    },
    [
      { field: 'people', value: 'Dessa', icon: '👥', label: 'With' },
      { field: 'emoji', value: '🎷', icon: '✨', label: 'Mood' },
    ]
  );

  assert.deepEqual(items, [
    { field: 'focus', label: 'Focus', icon: '🏷️', value: 'jazz', highlighted: false },
    { field: 'people', label: 'With', icon: '👥', value: 'Dessa', highlighted: true },
    { field: 'emoji', label: 'Mood', icon: '✨', value: '🎷', highlighted: true },
  ]);
});
