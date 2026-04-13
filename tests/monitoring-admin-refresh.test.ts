import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

function shouldDispatchHomepageRefresh(invOk: boolean): boolean {
  return invOk;
}

describe('monitoring admin observation refresh bridge', () => {
  test('dispatches homepage refresh after successful inventory refresh', () => {
    assert.equal(shouldDispatchHomepageRefresh(true), true);
  });

  test('does not dispatch when inventory refresh fails', () => {
    assert.equal(shouldDispatchHomepageRefresh(false), false);
  });
});
