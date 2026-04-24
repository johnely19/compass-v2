import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { diffTripEmergenceAttributes, applyTripAttributeChips } from '../app/_lib/trip-emergence';

function reduceDigestHydration(params: {
  activeKey: string;
  visibleEntryIds: string[];
  hydratedContexts: string[];
  previousSeen: string[];
}) {
  const { activeKey, visibleEntryIds, hydratedContexts, previousSeen } = params;

  const hydrated = new Set(hydratedContexts);
  let seen = previousSeen;

  if (!hydrated.has(activeKey)) {
    hydrated.add(activeKey);
    seen = visibleEntryIds;
    return { hydrated: [...hydrated], seen, shouldAnimate: false };
  }

  const newEntryIds = visibleEntryIds.filter(id => !seen.includes(id));
  seen = visibleEntryIds;
  return { hydrated: [...hydrated], seen, shouldAnimate: newEntryIds.length > 0 };
}

describe('intelligence digest hydration guard', () => {
  test('does not animate existing digest items on first hydration', () => {
    const result = reduceDigestHydration({
      activeKey: 'trip:nyc',
      visibleEntryIds: ['a', 'b'],
      hydratedContexts: [],
      previousSeen: [],
    });

    assert.equal(result.shouldAnimate, false);
    assert.deepEqual(result.seen, ['a', 'b']);
  });

  test('animates only when a later refresh introduces a new digest item', () => {
    const first = reduceDigestHydration({
      activeKey: 'trip:nyc',
      visibleEntryIds: ['a'],
      hydratedContexts: [],
      previousSeen: [],
    });

    const second = reduceDigestHydration({
      activeKey: 'trip:nyc',
      visibleEntryIds: ['a', 'c'],
      hydratedContexts: first.hydrated,
      previousSeen: first.seen,
    });

    assert.equal(second.shouldAnimate, true);
    assert.deepEqual(second.seen, ['a', 'c']);
  });

  test('switching to a new context hydrates quietly before later animations', () => {
    const result = reduceDigestHydration({
      activeKey: 'trip:paris',
      visibleEntryIds: ['p1'],
      hydratedContexts: ['trip:nyc'],
      previousSeen: [],
    });

    assert.equal(result.shouldAnimate, false);
    assert.deepEqual(result.seen, ['p1']);
  });
});

describe('priority emergence — diff', () => {
  test('emits a priorities chip when new priorities appear', () => {
    const attrs = diffTripEmergenceAttributes(
      { key: 'trip:nyc', priorities: ['Find a jazz club'] },
      { key: 'trip:nyc', priorities: ['Find a jazz club', 'Book a rooftop restaurant'] },
    );

    assert.deepEqual(attrs, [
      { field: 'priorities', value: 'Book a rooftop restaurant' },
    ]);
  });

  test('emits nothing when priorities are unchanged', () => {
    const attrs = diffTripEmergenceAttributes(
      { key: 'trip:nyc', priorities: ['Find a jazz club'] },
      { key: 'trip:nyc', priorities: ['Find a jazz club'] },
    );

    assert.deepEqual(attrs, []);
  });

  test('emits all new priorities at once', () => {
    const attrs = diffTripEmergenceAttributes(
      { key: 'trip:nyc' },
      { key: 'trip:nyc', priorities: ['Must-see museum', 'Hidden gem cafe', 'Night walk along the river'] },
    );

    assert.deepEqual(attrs, [
      { field: 'priorities', value: 'Must-see museum, Hidden gem cafe, Night walk along the river' },
    ]);
  });
});

describe('priority emergence — apply', () => {
  test('optimistically folds incoming priorities chips into the trip snapshot', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:tokyo',
        priorities: ['Visit the teamLab borderless museum'],
      },
      [
        { field: 'priorities', value: 'Book a bullet train seat, Find a ramen spot' },
      ],
    );

    assert.deepEqual(next.priorities, [
      'Visit the teamLab borderless museum',
      'Book a bullet train seat',
      'Find a ramen spot',
    ]);
  });

  test('deduplicates priorities on apply', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:tokyo',
        priorities: ['Visit the teamLab borderless museum'],
      },
      [
        { field: 'priorities', value: 'Visit the teamLab borderless museum, Explore Harajuku' },
      ],
    );

    assert.deepEqual(next.priorities, [
      'Visit the teamLab borderless museum',
      'Explore Harajuku',
    ]);
  });
});
