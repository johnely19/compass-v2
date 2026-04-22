import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIntelligenceAttachmentChips,
  buildMonitoringActionPrompts,
  buildMonitoringPromptAttachmentChips,
  diffTripEmergenceAttributes,
} from '../app/_lib/trip-emergence';

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
          significanceSummary: 'Hours updated for late-night sets',
        },
        {
          entryId: 'entry-3',
          contextKey: 'trip:paris',
          name: 'Folderol',
          significanceLevel: 'critical',
          significanceSummary: 'Rating dropped',
        },
      ],
    });

    assert.deepEqual(chips, [
      {
        field: 'intelligence',
        value: 'The Jazz Gallery · Hours updated for late-night sets',
        icon: '🕒',
        label: 'Hours update',
        tone: 'notable',
      },
    ]);
  });
});

describe('buildMonitoringActionPrompts', () => {
  test('maps closure and hours signals into trip actions', () => {
    const prompts = buildMonitoringActionPrompts({
      contextKey: 'trip:nyc',
      digestItems: [
        {
          entryId: 'a',
          contextKey: 'trip:nyc',
          name: 'Sailor',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'b',
          contextKey: 'trip:nyc',
          name: 'The Jazz Gallery',
          significanceLevel: 'notable',
          significanceSummary: 'Hours updated for late-night sets',
        },
      ],
    });

    assert.deepEqual(prompts, [
      {
        label: 'Line up a backup',
        detail: 'Sailor shows closure risk. Save a fallback now.',
        tone: 'critical',
      },
      {
        label: 'Re-check timing',
        detail: 'The Jazz Gallery changed hours or service details. Confirm before you go.',
        tone: 'notable',
      },
    ]);
  });

  test('keeps next-move prompts low-noise by suppressing repeated labels', () => {
    const prompts = buildMonitoringActionPrompts({
      contextKey: 'trip:nyc',
      limit: 3,
      digestItems: [
        {
          entryId: 'a',
          contextKey: 'trip:nyc',
          name: 'A',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'b',
          contextKey: 'trip:nyc',
          name: 'B',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'c',
          contextKey: 'trip:nyc',
          name: 'C',
          significanceLevel: 'notable',
          significanceSummary: 'Review sentiment improving fast this week',
        },
      ],
    });

    assert.deepEqual(prompts, [
      {
        label: 'Line up a backup',
        detail: 'A shows closure risk. Save a fallback now.',
        tone: 'critical',
      },
      {
        label: 'Check momentum',
        detail: 'C has shifted in the reviews. Decide if it still fits the trip.',
        tone: 'notable',
      },
    ]);
  });
});


describe('buildMonitoringPromptAttachmentChips', () => {
  test('turns fresh monitoring signals into a single durable next-move attachment chip', () => {
    const chips = buildMonitoringPromptAttachmentChips({
      contextKey: 'trip:nyc',
      previousEntryIds: ['old'],
      digestItems: [
        {
          entryId: 'old',
          contextKey: 'trip:nyc',
          name: 'Old Place',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'new',
          contextKey: 'trip:nyc',
          name: 'Sailor',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'other',
          contextKey: 'trip:paris',
          name: 'Other',
          significanceLevel: 'notable',
          significanceSummary: 'Hours updated',
        },
      ],
    });

    assert.deepEqual(chips, [
      {
        field: 'intelligence',
        label: 'Line up a backup',
        value: 'Sailor shows closure risk. Save a fallback now.',
        tone: 'critical',
        icon: '🚨',
      },
    ]);
  });

  test('keeps prompt attachment low-noise when several fresh entries imply the same move', () => {
    const chips = buildMonitoringPromptAttachmentChips({
      contextKey: 'trip:nyc',
      digestItems: [
        {
          entryId: 'a',
          contextKey: 'trip:nyc',
          name: 'A',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
        {
          entryId: 'b',
          contextKey: 'trip:nyc',
          name: 'B',
          significanceLevel: 'critical',
          significanceSummary: 'Possible closure after shutdown notice',
        },
      ],
    });

    assert.deepEqual(chips, [
      {
        field: 'intelligence',
        label: 'Line up a backup',
        value: 'A shows closure risk. Save a fallback now.',
        tone: 'critical',
        icon: '🚨',
      },
    ]);
  });
});
