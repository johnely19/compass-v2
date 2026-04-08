/**
 * Regression test for homepage context visibility (issue #255).
 *
 * Run: node --import tsx --test tests/homepage-contexts.test.ts
 *
 * Rules:
 * - Contexts with at least one discovery in their bucket → visible
 * - Contexts with zero discoveries in their bucket → hidden (except trips)
 * - Trip contexts → always visible (they carry planning widgets)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the visibility logic so this test doesn't depend on Next.js / server
// ---------------------------------------------------------------------------
type ContextType = 'trip' | 'outing' | 'radar';
interface Context {
  key: string;
  type: ContextType;
  label: string;
}

function computeVisibleContexts(
  contexts: Context[],
  byContext: Map<string, unknown[]>,
): Context[] {
  return contexts.filter(c =>
    c.type === 'trip' || (byContext.get(c.key)?.length ?? 0) > 0,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('homepage context visibility', () => {

  test('shows contexts that have discoveries', () => {
    const contexts: Context[] = [
      { key: 'radar:toronto', type: 'radar', label: 'Toronto Radar' },
    ];
    const byContext = new Map<string, unknown[]>([
      ['radar:toronto', [{ id: 'place-1' }]],
    ]);
    const visible = computeVisibleContexts(contexts, byContext);
    assert.equal(visible.length, 1, 'radar with discoveries should be visible');
  });

  test('hides outing and radar contexts with no discoveries', () => {
    const contexts: Context[] = [
      { key: 'outing:saturday', type: 'outing', label: 'Saturday Dinner' },
      { key: 'radar:toronto', type: 'radar', label: 'Toronto Radar' },
    ];
    const byContext = new Map<string, unknown[]>([
      ['outing:saturday', []],
      ['radar:toronto', []],
    ]);
    const visible = computeVisibleContexts(contexts, byContext);
    assert.equal(visible.length, 0, 'empty outing and radar should be hidden');
  });

  test('always shows trip contexts even with no discoveries', () => {
    const contexts: Context[] = [
      { key: 'trip:boston-aug-2026', type: 'trip', label: 'Boston August 2026' },
    ];
    const byContext = new Map<string, unknown[]>([
      ['trip:boston-aug-2026', []],
    ]);
    const visible = computeVisibleContexts(contexts, byContext);
    assert.equal(visible.length, 1, 'trip with no discoveries should still be visible');
  });

  test('mixed: trip without discoveries + outing without + radar with', () => {
    const contexts: Context[] = [
      { key: 'trip:nyc-2026', type: 'trip', label: 'NYC Trip' },
      { key: 'outing:dinner', type: 'outing', label: 'Dinner' },
      { key: 'radar:toronto', type: 'radar', label: 'Toronto Radar' },
    ];
    const byContext = new Map<string, unknown[]>([
      ['trip:nyc-2026', []],
      ['outing:dinner', []],
      ['radar:toronto', [{ id: 'p1' }, { id: 'p2' }]],
    ]);
    const visible = computeVisibleContexts(contexts, byContext);
    assert.equal(visible.length, 2, 'trip + radar with discoveries should be visible');
    assert.ok(visible.some(c => c.key === 'trip:nyc-2026'), 'trip should be visible');
    assert.ok(visible.some(c => c.key === 'radar:toronto'), 'radar with items should be visible');
    assert.ok(!visible.some(c => c.key === 'outing:dinner'), 'empty outing should be hidden');
  });

  test('context missing from byContext map is treated as empty', () => {
    const contexts: Context[] = [
      { key: 'radar:unknown', type: 'radar', label: 'Unknown Radar' },
    ];
    const byContext = new Map<string, unknown[]>();  // no entry for this key
    const visible = computeVisibleContexts(contexts, byContext);
    assert.equal(visible.length, 0, 'context absent from byContext should be hidden');
  });

});
