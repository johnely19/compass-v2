import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getMonitorDimensionsForType, getMonitoringCadence } from '../app/_lib/discovery-monitoring';

describe('getMonitoringCadence', () => {
  test('prioritizes active live trips with tighter cadence guidance', () => {
    assert.equal(getMonitoringCadence('priority', true), 'Check twice weekly while the trip is live.');
    assert.equal(getMonitoringCadence('active', true), 'Check weekly while the trip is live.');
  });

  test('keeps quieter cadences for non-live contexts', () => {
    assert.equal(getMonitoringCadence('priority', false), 'Check weekly until the signal cools.');
    assert.equal(getMonitoringCadence('active', false), 'Check every 2–3 weeks.');
    assert.equal(getMonitoringCadence('candidate', false), 'Check when a fresh source or availability update appears.');
  });
});

describe('getMonitorDimensionsForType', () => {
  test('includes type-specific triggers for hospitality monitoring', () => {
    const dims = getMonitorDimensionsForType('restaurant');
    assert.equal(dims[0]?.label, 'Reservations');
    assert.match(dims[0]?.trigger ?? '', /tables open up/i);
  });

  test('includes type-specific triggers for stay monitoring', () => {
    const dims = getMonitorDimensionsForType('hotel');
    assert.equal(dims[0]?.label, 'Availability');
    assert.match(dims[0]?.trigger ?? '', /target dates open/i);
  });
});
