import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

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
