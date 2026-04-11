/**
 * Run: node --import tsx --test tests/trip-emergence.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { diffTripAttributes, snapshotContext } from '../app/_lib/chat/emergence';

test('snapshotContext normalizes blanks and dedupes focus values', () => {
  const snapshot = snapshotContext({
    key: 'trip:boston',
    label: '  Boston Food Trip  ',
    emoji: ' ✈️ ',
    dates: ' ',
    city: ' Boston ',
    focus: ['food', 'food', ' architecture ', ''],
  });

  assert.deepEqual(snapshot, {
    key: 'trip:boston',
    label: 'Boston Food Trip',
    emoji: '✈️',
    dates: undefined,
    city: 'Boston',
    focus: ['food', 'architecture'],
  });
});

test('diffTripAttributes emits selective structured trip attributes in user-facing order', () => {
  const attrs = diffTripAttributes(
    snapshotContext({
      key: 'trip:boston',
      label: 'Boston Trip',
      emoji: '🗽',
      city: 'New York',
      focus: ['food'],
    }),
    snapshotContext({
      key: 'trip:boston',
      label: 'Boston Long Weekend',
      emoji: '🦞',
      dates: 'April 27-30, 2026',
      city: 'Boston',
      focus: ['food', 'architecture', 'jazz'],
    })
  );

  assert.deepEqual(attrs, [
    { field: 'label', value: 'Boston Long Weekend', icon: '🪪', label: 'Trip' },
    { field: 'city', value: 'Boston', icon: '📍', label: 'Destination' },
    { field: 'dates', value: 'April 27-30, 2026', icon: '📅', label: 'Dates' },
    { field: 'focus', value: 'architecture, jazz', icon: '🏷️', label: 'Focus' },
    { field: 'emoji', value: '🦞', icon: '✨', label: 'Mood' },
  ]);
});

test('diffTripAttributes ignores unchanged values', () => {
  const snapshot = snapshotContext({
    key: 'trip:boston',
    label: 'Boston Trip',
    emoji: '🦞',
    dates: 'April 27-30, 2026',
    city: 'Boston',
    focus: ['food', 'architecture'],
  });

  assert.deepEqual(diffTripAttributes(snapshot, snapshot), []);
});
