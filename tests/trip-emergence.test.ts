import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { applyTripAttributeChips, buildIntelligenceAttachmentChips, buildMonitoringActionPrompts, buildTripMonitoringHighlights, diffTripEmergenceAttributes } from '../app/_lib/trip-emergence';

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

  test('surfaces base address and host changes', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
        base: { address: '123 Main St', host: 'John' },
      },
      {
        key: 'trip:nyc',
        base: { address: '456 Park Ave', host: 'John', zone: 'Upper East Side' },
      },
    );

    assert.deepEqual(attrs, [
      { field: 'base', value: '456 Park Ave (John)' },
    ]);
  });

  test('surfaces base zone changes separately', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
        base: { address: '123 Main St', zone: 'Brooklyn' },
      },
      {
        key: 'trip:nyc',
        base: { address: '123 Main St', zone: 'Williamsburg' },
      },
    );

    assert.deepEqual(attrs, [
      { field: 'base', value: 'Zone: Williamsburg' },
    ]);
  });

  test('surfaces host-only changes', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
        base: { address: '123 Main St', host: 'John' },
      },
      {
        key: 'trip:nyc',
        base: { address: '123 Main St', host: 'Sarah' },
      },
    );

    assert.deepEqual(attrs, [
      { field: 'base', value: 'Host: Sarah' },
    ]);
  });
});

describe('applyTripAttributeChips', () => {
  test('optimistically folds incoming chips into the visible trip snapshot', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:tokyo',
        dates: 'May 2027',
        city: 'Tokyo',
        focus: ['food'],
        purpose: 'Food trip',
        people: [{ name: 'John' }],
      },
      [
        { field: 'dates', value: 'May 10 to May 18, 2027' },
        { field: 'focus', value: 'design, architecture' },
        { field: 'purpose', value: 'Spring architecture trip' },
        { field: 'people', value: 'Dessa (daughter), Huzur (wife)' },
        { field: 'intelligence', value: 'Ignored for optimistic card body' },
      ],
    );

    assert.deepEqual(next, {
      key: 'trip:tokyo',
      dates: 'May 10 to May 18, 2027',
      city: 'Tokyo',
      focus: ['food', 'design', 'architecture'],
      purpose: 'Spring architecture trip',
      people: [
        { name: 'John' },
        { name: 'Dessa', relation: 'daughter' },
        { name: 'Huzur', relation: 'wife' },
      ],
      priorities: [],
    });
  });

  test('applies base chips from chat-emerged attributes', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:nyc',
        dates: 'August 2026',
        city: 'New York',
      },
      [
        { field: 'base', value: '123 Bedford Ave (Sarah)' },
        { field: 'base', value: 'Zone: Brooklyn' },
      ],
    );

    assert.deepEqual(next, {
      key: 'trip:nyc',
      dates: 'August 2026',
      city: 'New York',
      focus: [],
      people: [],
      priorities: [],
      base: { address: '123 Bedford Ave', host: 'Sarah', zone: 'Brooklyn' },
    });
  });

  test('applies host-only and zone-only base chips', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:nyc',
        base: { address: '123 Main St' },
      },
      [
        { field: 'base', value: 'Host: John' },
        { field: 'base', value: 'Zone: Williamsburg' },
      ],
    );

    assert.deepEqual(next, {
      key: 'trip:nyc',
      focus: [],
      people: [],
      priorities: [],
      base: { address: '123 Main St', host: 'John', zone: 'Williamsburg' },
    });
  });
});

describe('buildTripMonitoringHighlights', () => {
  test('keeps a small durable set of high-signal monitoring highlights for the active trip', () => {
    const highlights = buildTripMonitoringHighlights({
      contextKey: 'trip:nyc',
      digestItems: [
        { entryId: 'a', contextKey: 'trip:nyc', name: 'Sailor', significanceLevel: 'critical', significanceSummary: 'Closure detected' },
        { entryId: 'b', contextKey: 'trip:nyc', name: 'The Jazz Gallery', significanceLevel: 'notable', significanceSummary: 'Hours updated' },
        { entryId: 'c', contextKey: 'trip:nyc', name: 'Casa Mono', significanceLevel: 'routine', significanceSummary: 'More reviews' },
        { entryId: 'd', contextKey: 'trip:paris', name: 'Folderol', significanceLevel: 'critical', significanceSummary: 'Rating dropped' },
      ],
    });

    assert.deepEqual(highlights, [
      'Sailor · Closure detected',
      'The Jazz Gallery · Hours updated',
    ]);
  });
});

describe('buildMonitoringActionPrompts', () => {
  test('turns high-signal monitoring changes into compact action-oriented prompts', () => {
    const prompts = buildMonitoringActionPrompts({
      contextKey: 'trip:nyc',
      digestItems: [
        { entryId: 'a', contextKey: 'trip:nyc', name: 'Sailor', significanceLevel: 'critical', significanceSummary: 'Closure detected' },
        { entryId: 'b', contextKey: 'trip:nyc', name: 'The Jazz Gallery', significanceLevel: 'notable', significanceSummary: 'Hours updated' },
        { entryId: 'c', contextKey: 'trip:nyc', name: 'Casa Mono', significanceLevel: 'notable', significanceSummary: 'Availability changed' },
      ],
    });

    assert.deepEqual(prompts, [
      { label: 'Backup plan', detail: 'Sailor may be at risk, line up an alternate now.' },
      { label: 'Reconfirm timing', detail: 'The Jazz Gallery changed hours, recheck before you go.' },
    ]);
  });
});

describe('buildIntelligenceAttachmentChips', () => {
  test('selects only new notable or critical digest items for the active context', () => {
    const chips = buildIntelligenceAttachmentChips({
      contextKey: 'trip:nyc',
      previousEntryIds: ['entry-1'],
      digestItems: [
        {
          entryId: 'entry-1',
          contextKey: 'trip:nyc',
          name: 'Sailor',
          significanceLevel: 'critical',
          significanceSummary: 'Closure detected',
        },
        {
          entryId: 'entry-2',
          contextKey: 'trip:nyc',
          name: 'The Jazz Gallery',
          significanceLevel: 'notable',
          significanceSummary: 'Hours updated',
        },
        {
          entryId: 'entry-3',
          contextKey: 'trip:paris',
          name: 'Folderol',
          significanceLevel: 'critical',
          significanceSummary: 'Rating dropped',
        },
        {
          entryId: 'entry-4',
          contextKey: 'trip:nyc',
          name: 'Casa Mono',
          significanceLevel: 'routine',
          significanceSummary: 'More reviews',
        },
      ],
    });

    assert.deepEqual(chips, [
      { field: 'intelligence', value: 'The Jazz Gallery · Hours updated' },
    ]);
  });

  test('caps intelligence chips to a small low-noise set', () => {
    const chips = buildIntelligenceAttachmentChips({
      contextKey: 'trip:nyc',
      limit: 2,
      digestItems: [
        { entryId: 'a', contextKey: 'trip:nyc', name: 'A', significanceLevel: 'critical', significanceSummary: 'One' },
        { entryId: 'b', contextKey: 'trip:nyc', name: 'B', significanceLevel: 'notable', significanceSummary: 'Two' },
        { entryId: 'c', contextKey: 'trip:nyc', name: 'C', significanceLevel: 'critical', significanceSummary: 'Three' },
      ],
    });

    assert.deepEqual(chips, [
      { field: 'intelligence', value: 'A · One' },
      { field: 'intelligence', value: 'B · Two' },
    ]);
  });
});

describe('accommodation field', () => {
  test('surfaces accommodation name changes with address', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
      },
      {
        key: 'trip:nyc',
        accommodationName: 'The Liberty Hotel',
        accommodationAddress: '215 Chestnut St',
      },
    );

    assert.deepEqual(attrs, [
      { field: 'accommodation', value: 'The Liberty Hotel · 215 Chestnut St' },
    ]);
  });

  test('surfaces accommodation name-only changes', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
        accommodationName: 'Hilton Boston',
      },
      {
        key: 'trip:nyc',
        accommodationName: 'The Liberty Hotel',
      },
    );

    assert.deepEqual(attrs, [
      { field: 'accommodation', value: 'The Liberty Hotel' },
    ]);
  });

  test('surfaces address-only changes when name is missing', () => {
    const attrs = diffTripEmergenceAttributes(
      {
        key: 'trip:nyc',
      },
      {
        key: 'trip:nyc',
        accommodationName: 'The Liberty Hotel',
        accommodationAddress: '215 Chestnut St',
      },
    );

    assert.deepEqual(attrs, [
      { field: 'accommodation', value: 'The Liberty Hotel · 215 Chestnut St' },
    ]);
  });

  test('applies accommodation chips from chat-emerged attributes', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:nyc',
        dates: 'August 2026',
        city: 'New York',
      },
      [
        { field: 'accommodation', value: 'The Liberty Hotel · 215 Chestnut St' },
      ],
    );

    assert.deepEqual(next, {
      key: 'trip:nyc',
      dates: 'August 2026',
      city: 'New York',
      focus: [],
      people: [],
      priorities: [],
      accommodationName: 'The Liberty Hotel',
      accommodationAddress: '215 Chestnut St',
    });
  });

  test('applies accommodation name-only chips', () => {
    const next = applyTripAttributeChips(
      {
        key: 'trip:nyc',
      },
      [
        { field: 'accommodation', value: 'Ace Hotel' },
      ],
    );

    assert.deepEqual(next, {
      key: 'trip:nyc',
      focus: [],
      people: [],
      priorities: [],
      accommodationName: 'Ace Hotel',
    });
  });
});
