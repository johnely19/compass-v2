import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt, type ChatContext } from '../app/_lib/chat/system-prompt';

test('buildSystemPrompt includes rich facts for known trip contexts', () => {
  const context: ChatContext = {
    userCode: 'john',
    userCity: 'Toronto',
    preferences: null,
    manifest: {
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
          key: 'trip:boston-summer-2026',
          label: 'Boston Long Weekend',
          emoji: '🦞',
          type: 'trip',
          city: 'Boston',
          dates: 'Late August 2026',
          focus: ['food', 'history'],
          active: false,
          status: 'archived',
        },
      ],
    },
    recentDiscoveries: [],
    knownDiscoveries: [
      {
        contextKey: 'trip:cottage-july-2026',
        name: 'The Lookout',
        type: 'accommodation',
        city: 'Port Albert',
        address: 'Port Albert',
        discoveredAt: '2026-03-15T00:00:00.000Z',
      },
    ],
  };

  const prompt = buildSystemPrompt(context);

  assert.match(prompt, /## KNOWN CONTEXTS/);
  assert.match(prompt, /Ontario Cottage/);
  assert.match(prompt, /Location: Lake Huron/);
  assert.match(prompt, /Known places: The Lookout \(accommodation, Port Albert\)/);
  assert.match(prompt, /Boston Long Weekend/);
  assert.match(prompt, /archived/);
});

test('buildSystemPrompt expands active chat target with trip details', () => {
  const context: ChatContext = {
    userCode: 'john',
    userCity: 'Toronto',
    preferences: null,
    manifest: {
      updatedAt: '2026-04-10T00:00:00.000Z',
      contexts: [
        {
          key: 'trip:nyc-april-2026',
          label: 'NYC Solo Trip',
          emoji: '🗽',
          type: 'trip',
          city: 'New York',
          dates: '2026-04-27 to 2026-04-30',
          focus: ['galleries', 'jazz'],
          active: true,
          bookingStatus: 'fully-booked',
          accommodation: {
            name: "Arnold's",
            address: '126 Leonard St',
            status: 'booked',
          },
          people: [
            { name: 'Dessa', relation: 'daughter' },
          ],
          purpose: "Dessa's art show + Brooklyn exploration",
          notes: 'Stay in Williamsburg and focus on galleries.',
        },
      ],
    },
    recentDiscoveries: [],
    activeContextKey: 'trip:nyc-april-2026',
  };

  const prompt = buildSystemPrompt(context);

  assert.match(prompt, /## ACTIVE CHAT TARGET/);
  assert.match(prompt, /Known facts for this target:/);
  assert.match(prompt, /Accommodation: Arnold's, 126 Leonard St, status: booked/);
  assert.match(prompt, /People: Dessa \(daughter\)/);
  assert.match(prompt, /Purpose: Dessa's art show \+ Brooklyn exploration/);
});
