/**
 * Regression tests for issue #287 — chat-driven trip context switching.
 *
 * These tests cover the pure logic used by HomeClient.tsx and the chat route
 * to keep the homepage in sync with chat actions across both new and existing
 * trips. They intentionally avoid rendering React to keep the test fast and
 * environment-free (pure node:test + tsx).
 *
 * Run: node --import tsx --test tests/home-context-switch.test.ts
 *
 * Covered behaviours:
 * 1. Route-level resolution of a tool call's target contextKey
 *    (create_context derives the key from label; existing-context tools
 *    canonically resolve natural phrasing to the saved key when possible).
 * 2. HomeClient-style reducer for chat-driven switches:
 *    - If the target key is in the current contexts → apply immediately
 *    - If the target key is NOT yet in contexts → stash as pending
 *    - When contexts later include the pending key → apply it
 *    - localStorage must not overwrite a chat-driven switch on later refresh
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveContextKey, type KnownContextDiscovery } from '../app/_lib/chat/context-resolution';
import { computeContextKey } from '../app/_lib/chat/tools/create-context';
import type { UserManifest } from '../app/_lib/types';

// ---------------------------------------------------------------------------
// Pure function mirroring app/api/chat/route.ts resolveTargetContextKey.
// Kept inline here so the test is a tight unit test around the SAME rule.
// ---------------------------------------------------------------------------
function resolveTargetContextKey(
  toolName: string,
  input: Record<string, unknown>,
  manifest: UserManifest | null = null,
  knownDiscoveries: KnownContextDiscovery[] = [],
): string | undefined {
  if (toolName === 'create_context') {
    const type = typeof input?.type === 'string' ? input.type : undefined;
    const label = typeof input?.label === 'string' ? input.label : undefined;
    if (type && label) {
      try { return computeContextKey({ type, label }); } catch { return undefined; }
    }
    return undefined;
  }
  const ck = input?.contextKey;
  if (typeof ck !== 'string' || ck.length === 0) return undefined;
  return resolveContextKey(ck, manifest, knownDiscoveries) || ck;
}

// ---------------------------------------------------------------------------
// Tiny reducer modelling HomeClient.tsx active-context state machine.
// The goal is to exercise the switch semantics without React: given a
// sequence of events, what is the final { activeKey, pendingKey }?
// ---------------------------------------------------------------------------
interface Ctx { key: string }
interface SwitchState {
  activeKey: string | null;
  pendingKey: string | null;
  contexts: Ctx[];
  localStorage: string | null;
  initialized: boolean;
}

type Event =
  | { kind: 'mount'; initialContexts: Ctx[] }
  | { kind: 'chat-switch'; key: string }
  | { kind: 'contexts-refresh'; contexts: Ctx[] }
  | { kind: 'user-select'; key: string };

function reduce(state: SwitchState, event: Event): SwitchState {
  switch (event.kind) {
    case 'mount': {
      // First mount reads localStorage; otherwise falls back to first context.
      if (state.initialized) return state;
      const stored = state.localStorage;
      const activeKey = stored || event.initialContexts[0]?.key || null;
      return {
        ...state,
        initialized: true,
        contexts: event.initialContexts,
        activeKey,
        // Persist in localStorage to mirror applyActiveKey
        localStorage: activeKey,
      };
    }
    case 'chat-switch': {
      if (state.contexts.some(c => c.key === event.key)) {
        // Apply immediately + sync localStorage
        return { ...state, activeKey: event.key, pendingKey: null, localStorage: event.key };
      }
      // Pending: also sync localStorage so a refresh-driven init cannot
      // revert the switch.
      return { ...state, pendingKey: event.key, localStorage: event.key };
    }
    case 'contexts-refresh': {
      // NOTE: this is the critical regression check.
      // On refresh, HomeClient must NOT re-read localStorage and clobber
      // a chat-driven switch. Only pending-key application should happen.
      const newState: SwitchState = { ...state, contexts: event.contexts };
      if (newState.pendingKey && event.contexts.some(c => c.key === newState.pendingKey)) {
        newState.activeKey = newState.pendingKey;
        newState.localStorage = newState.pendingKey;
        newState.pendingKey = null;
      }
      return newState;
    }
    case 'user-select': {
      return { ...state, activeKey: event.key, pendingKey: null, localStorage: event.key };
    }
  }
}

function initialState(): SwitchState {
  return { activeKey: null, pendingKey: null, contexts: [], localStorage: null, initialized: false };
}

// ---------------------------------------------------------------------------
// Tiny helper modelling ChatWidget's toolResult -> switch-event forwarding.
// The key regression for #289 is that "already on this key" dedupe is unsafe:
// the ref can drift ahead of actual homepage state, so the event still needs
// to fire to repair the UI on a return hop.
// ---------------------------------------------------------------------------
function forwardToolResultContextKey(
  refKey: string | null,
  parsedContextKey: string | undefined,
): { nextRefKey: string | null; dispatchedKeys: string[] } {
  if (!parsedContextKey) {
    return { nextRefKey: refKey, dispatchedKeys: [] };
  }
  return {
    nextRefKey: parsedContextKey,
    dispatchedKeys: [parsedContextKey],
  };
}

// ---------------------------------------------------------------------------
describe('route.resolveTargetContextKey', () => {
  const manifest: UserManifest = {
    updatedAt: '2026-04-10T00:00:00.000Z',
    contexts: [
      {
        key: 'trip:cottage-july-2026',
        label: 'Ontario Cottage',
        emoji: '🏊',
        type: 'trip',
        city: 'Lake Huron',
        dates: 'July 2026 (3+ weeks)',
        focus: ['waterfront', 'swimming'],
        active: true,
      },
      {
        key: 'trip:nyc-solo-trip',
        label: 'NYC Solo Trip',
        emoji: '🗽',
        type: 'trip',
        city: 'New York',
        dates: '2026-04-27 to 2026-04-30',
        focus: ['galleries', 'jazz'],
        active: true,
      },
    ],
  };

  const knownDiscoveries: KnownContextDiscovery[] = [
    {
      contextKey: 'trip:cottage-july-2026',
      name: 'The Lookout',
      type: 'accommodation',
      city: 'Port Albert',
      address: 'Port Albert',
      discoveredAt: '2026-03-15T00:00:00.000Z',
    },
  ];

  test('create_context derives key from type + label (matches tool slug)', () => {
    const key = resolveTargetContextKey('create_context', { type: 'trip', label: 'Barcelona November 2026' });
    assert.equal(key, 'trip:barcelona-november-2026');
  });

  test('create_context strips punctuation like the tool', () => {
    const key = resolveTargetContextKey('create_context', { type: 'trip', label: "NYC Solo Trip (Spring!)" });
    assert.equal(key, 'trip:nyc-solo-trip-spring');
  });

  test('create_context returns undefined when type or label missing', () => {
    assert.equal(resolveTargetContextKey('create_context', { label: 'no type' }), undefined);
    assert.equal(resolveTargetContextKey('create_context', { type: 'trip' }), undefined);
  });

  test('add_to_compass reads contextKey from input', () => {
    const key = resolveTargetContextKey('add_to_compass', { contextKey: 'trip:boston-aug-2026', name: 'x' }, manifest, knownDiscoveries);
    assert.equal(key, 'trip:boston-aug-2026');
  });

  test('update_trip reads contextKey from input', () => {
    const key = resolveTargetContextKey('update_trip', { contextKey: 'trip:nyc-solo-trip', dates: 'April 27-30, 2026' }, manifest, knownDiscoveries);
    assert.equal(key, 'trip:nyc-solo-trip');
  });

  test('set_active_context reads contextKey from input', () => {
    const key = resolveTargetContextKey('set_active_context', { contextKey: 'trip:paris-2027' }, manifest, knownDiscoveries);
    assert.equal(key, 'trip:paris-2027');
  });

  test('canonicalizes semantic trip phrasing to the saved key', () => {
    const key = resolveTargetContextKey('set_active_context', { contextKey: 'Lake Huron cottage trip' }, manifest, knownDiscoveries);
    assert.equal(key, 'trip:cottage-july-2026');
  });

  test('canonicalizes saved-place phrasing to the saved key', () => {
    const key = resolveTargetContextKey('set_active_context', { contextKey: 'The Lookout trip' }, manifest, knownDiscoveries);
    assert.equal(key, 'trip:cottage-july-2026');
  });

  test('edit_discovery / remove_discovery also surface contextKey', () => {
    assert.equal(resolveTargetContextKey('edit_discovery', { contextKey: 'outing:sat-dinner', name: 'x', updates: {} }, manifest, knownDiscoveries), 'outing:sat-dinner');
    assert.equal(resolveTargetContextKey('remove_discovery', { contextKey: 'radar:downtown', name: 'x' }, manifest, knownDiscoveries), 'radar:downtown');
  });

  test('returns undefined when no contextKey is present', () => {
    assert.equal(resolveTargetContextKey('web_search', { query: 'foo' }), undefined);
    assert.equal(resolveTargetContextKey('lookup_place', { query: 'foo' }), undefined);
  });
});

// ---------------------------------------------------------------------------
describe('HomeClient chat switch reducer (issue #287)', () => {
  test('new trip: chat switches to a key not yet in contexts, then refresh brings it in', () => {
    // Start with Boston as the only context, localStorage pointing at Boston.
    let s = initialState();
    s.localStorage = 'trip:boston-aug-2026';
    s = reduce(s, { kind: 'mount', initialContexts: [{ key: 'trip:boston-aug-2026' }] });
    assert.equal(s.activeKey, 'trip:boston-aug-2026');

    // Chat creates a Barcelona trip, dispatches switch BEFORE contexts refresh.
    s = reduce(s, { kind: 'chat-switch', key: 'trip:barcelona-nov-2026' });
    assert.equal(s.pendingKey, 'trip:barcelona-nov-2026', 'should stash as pending');
    assert.equal(s.activeKey, 'trip:boston-aug-2026', 'active stays on boston until refresh');
    assert.equal(s.localStorage, 'trip:barcelona-nov-2026', 'localStorage updated so refresh cannot clobber');

    // Refresh brings Barcelona into the contexts list.
    s = reduce(s, { kind: 'contexts-refresh', contexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:barcelona-nov-2026' },
    ]});
    assert.equal(s.activeKey, 'trip:barcelona-nov-2026', 'active switches once context is present');
    assert.equal(s.pendingKey, null, 'pending cleared');
  });

  test('existing trip: chat switches between two existing trips applies immediately', () => {
    // Mount with Boston + NYC in contexts, localStorage on Boston.
    let s = initialState();
    s.localStorage = 'trip:boston-aug-2026';
    s = reduce(s, { kind: 'mount', initialContexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:nyc-solo-trip' },
    ]});
    assert.equal(s.activeKey, 'trip:boston-aug-2026');

    // User asks to review NYC in chat → set_active_context fires.
    s = reduce(s, { kind: 'chat-switch', key: 'trip:nyc-solo-trip' });
    assert.equal(s.activeKey, 'trip:nyc-solo-trip');
    assert.equal(s.localStorage, 'trip:nyc-solo-trip', 'localStorage follows the switch');
  });

  test('refresh after chat switch must NOT revert to stale localStorage-based init', () => {
    // Simulate the regression: user is on Boston, chat switches to NYC, then
    // data refresh fires. Previous buggy behaviour re-ran the init effect and
    // reset activeKey to whatever localStorage said. With the fix, refresh is
    // a no-op for activeKey.
    let s = initialState();
    s.localStorage = 'trip:boston-aug-2026';
    s = reduce(s, { kind: 'mount', initialContexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:nyc-solo-trip' },
    ]});

    s = reduce(s, { kind: 'chat-switch', key: 'trip:nyc-solo-trip' });
    // Refresh arrives with the same contexts.
    s = reduce(s, { kind: 'contexts-refresh', contexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:nyc-solo-trip' },
    ]});
    assert.equal(s.activeKey, 'trip:nyc-solo-trip', 'refresh must not revert chat-driven switch');
  });

  test('user manual select beats chat: later chat-switch to unknown key pends, not loses select', () => {
    let s = initialState();
    s.localStorage = 'trip:boston-aug-2026';
    s = reduce(s, { kind: 'mount', initialContexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:nyc-solo-trip' },
    ]});
    s = reduce(s, { kind: 'user-select', key: 'trip:nyc-solo-trip' });
    assert.equal(s.activeKey, 'trip:nyc-solo-trip');

    // Chat wants to create Paris. Paris isn't in contexts yet.
    s = reduce(s, { kind: 'chat-switch', key: 'trip:paris-2027' });
    assert.equal(s.activeKey, 'trip:nyc-solo-trip', 'active unchanged while waiting for contexts refresh');
    assert.equal(s.pendingKey, 'trip:paris-2027');

    // Contexts refresh brings Paris in.
    s = reduce(s, { kind: 'contexts-refresh', contexts: [
      { key: 'trip:boston-aug-2026' },
      { key: 'trip:nyc-solo-trip' },
      { key: 'trip:paris-2027' },
    ]});
    assert.equal(s.activeKey, 'trip:paris-2027');
  });

  test('quick consecutive chat switches apply in order', () => {
    let s = initialState();
    s = reduce(s, { kind: 'mount', initialContexts: [
      { key: 'trip:a' },
      { key: 'trip:b' },
      { key: 'trip:c' },
    ]});
    s = reduce(s, { kind: 'chat-switch', key: 'trip:b' });
    assert.equal(s.activeKey, 'trip:b');
    s = reduce(s, { kind: 'chat-switch', key: 'trip:c' });
    assert.equal(s.activeKey, 'trip:c');
    // Final localStorage reflects the last switch.
    assert.equal(s.localStorage, 'trip:c');
  });
});

// ---------------------------------------------------------------------------
describe('ChatWidget toolResult forwarding (issue #289)', () => {
  test('re-emits a switch event even when the local ref already matches the target key', () => {
    const result = forwardToolResultContextKey('trip:nyc-solo-trip', 'trip:nyc-solo-trip');
    assert.equal(result.nextRefKey, 'trip:nyc-solo-trip');
    assert.deepEqual(result.dispatchedKeys, ['trip:nyc-solo-trip']);
  });

  test('multi-hop existing-trip switches forward every hop in order', () => {
    let refKey: string | null = 'trip:nyc-solo-trip';
    const dispatched: string[] = [];

    for (const hop of ['trip:ontario-cottage-july-2026', 'trip:nyc-solo-trip']) {
      const result = forwardToolResultContextKey(refKey, hop);
      refKey = result.nextRefKey;
      dispatched.push(...result.dispatchedKeys);
    }

    assert.equal(refKey, 'trip:nyc-solo-trip');
    assert.deepEqual(dispatched, [
      'trip:ontario-cottage-july-2026',
      'trip:nyc-solo-trip',
    ]);
  });
});
