import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseToolEvent, extractCreateContextUsed, extractUpdateTripUsed, computeNewContexts, computeChangedAttributes } from '../app/_lib/chat/emergence-helpers';

describe('parseToolEvent', () => {
  test('parses create-context tool event', () => {
    const result = parseToolEvent('{"tool":"create-context"}');
    assert.ok(result !== undefined);
    assert.equal(result?.tool, 'create-context');
  });

  test('parses update-trip tool event', () => {
    const result = parseToolEvent('{"tool":"update-trip"}');
    assert.ok(result !== undefined);
    assert.equal(result?.tool, 'update-trip');
  });

  test('returns undefined for toolResult without tool field', () => {
    // parseToolEvent only handles events with a "tool" field, not toolResult events
    const result = parseToolEvent('{"toolResult":"add-to-compass","contextKey":"trip:nyc"}');
    assert.equal(result, undefined);
  });

  test('returns undefined for content-only event', () => {
    const result = parseToolEvent('{"content":"Hello there"}');
    assert.equal(result, undefined);
  });

  test('returns undefined for non-JSON', () => {
    const result = parseToolEvent('not json');
    assert.equal(result, undefined);
  });

  test('returns undefined for empty object', () => {
    const result = parseToolEvent('{}');
    assert.equal(result, undefined);
  });
});

describe('extractCreateContextUsed', () => {
  test('returns true when create-context tool present', () => {
    const events = [
      { tool: 'web-search' },
      { tool: 'create-context' },
    ];
    assert.equal(extractCreateContextUsed(events), true);
  });

  test('returns false when no create-context tool', () => {
    const events = [
      { tool: 'web-search' },
      { tool: 'lookup-place' },
    ];
    assert.equal(extractCreateContextUsed(events), false);
  });

  test('returns false for empty events', () => {
    assert.equal(extractCreateContextUsed([]), false);
  });
});

describe('extractUpdateTripUsed', () => {
  test('returns any when update-trip tool present', () => {
    const events = [
      { tool: 'update-trip' },
    ];
    assert.equal(extractUpdateTripUsed(events), '__any__');
  });

  test('returns null when no update-trip tool', () => {
    const events = [
      { tool: 'create-context' },
    ];
    assert.equal(extractUpdateTripUsed(events), null);
  });

  test('returns null for empty events', () => {
    assert.equal(extractUpdateTripUsed([]), null);
  });
});

describe('computeNewContexts', () => {
  test('returns new contexts not in preKeys', () => {
    const preKeys = new Set(['trip:existing']);
    const allCtxs = [
      { key: 'trip:existing', label: 'Existing' },
      { key: 'trip:new', label: 'New Trip' },
    ];

    const result = computeNewContexts(preKeys, allCtxs);
    assert.equal(result.length, 1);
    assert.equal(result[0].key, 'trip:new');
  });

  test('returns all when preKeys is empty set', () => {
    const preKeys = new Set<string>();
    const allCtxs = [
      { key: 'trip:one', label: 'One' },
      { key: 'trip:two', label: 'Two' },
    ];

    const result = computeNewContexts(preKeys, allCtxs);
    assert.equal(result.length, 2);
  });

  test('returns empty when all contexts existed', () => {
    const preKeys = new Set(['trip:a', 'trip:b']);
    const allCtxs = [
      { key: 'trip:a', label: 'A' },
      { key: 'trip:b', label: 'B' },
    ];

    const result = computeNewContexts(preKeys, allCtxs);
    assert.equal(result.length, 0);
  });
});

describe('computeChangedAttributes', () => {
  test('returns changed attributes when context updated', () => {
    const pre = { key: 'trip:nyc', city: 'New York', dates: 'June 2026' };
    const current = { key: 'trip:nyc', city: 'New York', dates: 'June 10-15, 2026' };

    const attrs = computeChangedAttributes(pre, current);
    assert.equal(attrs.length, 1);
    assert.equal(attrs[0].field, 'dates');
    assert.equal(attrs[0].value, 'June 10-15, 2026');
  });

  test('returns empty when no previous snapshot', () => {
    const current = { key: 'trip:nyc', city: 'New York' };

    const attrs = computeChangedAttributes(undefined, current);
    assert.equal(attrs.length, 0);
  });

  test('returns empty when no changes', () => {
    const pre = { key: 'trip:nyc', city: 'New York' };
    const current = { key: 'trip:nyc', city: 'New York' };

    const attrs = computeChangedAttributes(pre, current);
    assert.equal(attrs.length, 0);
  });

  test('captures multiple field changes', () => {
    const pre = { key: 'trip:tokyo', city: 'Tokyo', focus: ['food'] };
    const current = { key: 'trip:tokyo', city: 'Kyoto', focus: ['food', 'design'], purpose: 'Architecture trip' };

    const attrs = computeChangedAttributes(pre, current);
    assert.equal(attrs.length, 3);
    const fields = attrs.map(a => a.field);
    assert.ok(fields.includes('city'));
    assert.ok(fields.includes('focus'));
    assert.ok(fields.includes('purpose'));
  });
});

describe('emergence path integration', () => {
  test('create-context leads to new-context emergence', () => {
    // Simulate the full path: tool detection -> emergence dispatch
    const sseData = [
      '{"content":"Let me create a new trip for you."}',
      '{"tool":"create-context"}',
    ];

    const toolEvents = sseData.map(parseToolEvent).filter((e): e is NonNullable<typeof e> => e !== undefined);

    const hasNewContext = extractCreateContextUsed(toolEvents);
    assert.equal(hasNewContext, true);

    // Simulate pre-existing contexts
    const preKeys = new Set(['trip:paris']);
    const allCtxs = [
      { key: 'trip:paris', label: 'Paris Trip' },
      { key: 'trip:tokyo', label: 'Tokyo Trip', type: 'trip', emoji: '🗼' },
    ];

    const newContexts = computeNewContexts(preKeys, allCtxs);
    assert.equal(newContexts.length, 1);
    assert.equal(newContexts[0].key, 'trip:tokyo');
  });

  test('update-trip leads to attribute attachment', () => {
    const sseData = [
      '{"content":"Updating your trip details."}',
      '{"tool":"update-trip"}',
    ];

    const toolEvents = sseData.map(parseToolEvent).filter((e): e is NonNullable<typeof e> => e !== undefined);

    const hasUpdateTrip = extractUpdateTripUsed(toolEvents);
    assert.equal(hasUpdateTrip, '__any__');

    // Simulate pre and post context snapshots
    const preSnapshot = {
      key: 'trip:nyc',
      city: 'New York',
      dates: 'August 2026',
      focus: ['food'],
    };
    const currentSnapshot = {
      key: 'trip:nyc',
      city: 'New York',
      dates: 'August 10-17, 2026',
      focus: ['food', 'jazz'],
      purpose: 'Birthday celebration',
    };

    const attrs = computeChangedAttributes(preSnapshot, currentSnapshot);
    assert.ok(attrs.length > 0);
    const fields = attrs.map(a => a.field);
    assert.ok(fields.includes('dates'));
    assert.ok(fields.includes('focus'));
    assert.ok(fields.includes('purpose'));
  });

  test('no emergence events when no relevant tool used', () => {
    const sseData = [
      '{"content":"I found a great restaurant for you."}',
      '{"tool":"lookup-place"}',
      '{"toolResult":"add-to-compass"}',
    ];

    const toolEvents = sseData.map(parseToolEvent).filter((e): e is NonNullable<typeof e> => e !== undefined);

    const hasNewContext = extractCreateContextUsed(toolEvents);
    const hasUpdateTrip = extractUpdateTripUsed(toolEvents);

    assert.equal(hasNewContext, false);
    assert.equal(hasUpdateTrip, null);
  });
});