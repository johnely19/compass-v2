import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { diffTripEmergenceAttributes } from '../app/_lib/trip-emergence';

describe('diffTripEmergenceAttributes', () => {
  test('returns only newly attached focus items', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
        focus: ['food'],
      },
      {
        key: 'trip:nyc',
        focus: ['food', 'jazz', 'architecture'],
      },
    );

    assert.deepEqual(attrs, [
      { field: 'focus', value: 'jazz, architecture' },
    ]);
  });

  test('surfaces purpose and people changes for trip emergence chips', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:paris',
        purpose: 'Anniversary escape',
        people: [{ name: 'John' }],
      },
      {
        key: 'trip:paris',
        purpose: 'Anniversary escape with gallery days',
        people: [{ name: 'John' }, { name: 'Huzur', relation: 'wife' }],
      },
    );

    assert.deepEqual(attrs, [
      { field: 'purpose', value: 'Anniversary escape with gallery days' },
      { field: 'people', value: 'Huzur (wife)' },
    ]);
  });

  test('includes core trip changes in stable order', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:tokyo',
        dates: 'May 2027',
        city: 'Tokyo',
        focus: ['food'],
      },
      {
        key: 'trip:tokyo',
        dates: 'May 10 to May 18, 2027',
        city: 'Kyoto',
        focus: ['food', 'design'],
        purpose: 'Spring architecture trip',
        people: [{ name: 'John' }, { name: 'Dessa', relation: 'daughter' }],
      },
    );

    assert.deepEqual(attrs, [
      { field: 'dates', value: 'May 10 to May 18, 2027' },
      { field: 'city', value: 'Kyoto' },
      { field: 'focus', value: 'design' },
      { field: 'purpose', value: 'Spring architecture trip' },
      { field: 'people', value: 'John, Dessa (daughter)' },
    ]);
  });
});
