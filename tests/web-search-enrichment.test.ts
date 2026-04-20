import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNotes,
  buildSearchQuery,
  detectSignalMatches,
  parseSignals,
} from '../app/_lib/web-search-enrichment';

describe('web search enrichment signal detection', () => {
  test('detects hospitality-specific awards language', () => {
    const results = [{
      title: 'Bodega wins Michelin Bib Gourmand',
      url: 'https://example.com/bodega-award',
      description: 'The restaurant was named one of the best new spots by Michelin.',
    }];

    assert.deepEqual(parseSignals(results, 'hospitality'), ['sentiment-shift']);
  });

  test('detects stay-specific availability pressure', () => {
    const results = [{
      title: 'Harbour Hotel fully booked for festival weekend',
      url: 'https://example.com/harbour-hotel',
      description: 'Management says there is no availability and a waitlist is open.',
    }];

    assert.deepEqual(parseSignals(results, 'stay'), ['availability-changed']);
  });

  test('detects development-specific construction milestones', () => {
    const results = [{
      title: 'Elm Tower tops out after permit approved',
      url: 'https://example.com/elm-tower',
      description: 'Construction progress continues and the development is opening soon.',
    }];

    assert.deepEqual(parseSignals(results, 'development'), ['construction-signal']);
  });

  test('detects culture-specific program announcements', () => {
    const results = [{
      title: 'Museum announces new exhibition lineup',
      url: 'https://example.com/museum',
      description: 'The season announcement includes a major retrospective this fall.',
    }];

    assert.deepEqual(parseSignals(results, 'culture'), ['description-changed']);
  });

  test('detects general operating updates without using specialty rules', () => {
    const results = [{
      title: 'Corner Studio opens new location in the east end',
      url: 'https://example.com/corner-studio',
      description: 'The business is now open after relocating from its previous address.',
    }];

    assert.deepEqual(parseSignals(results, 'general'), ['general-update']);
    assert.deepEqual(parseSignals(results, 'unknown-type'), ['general-update']);
  });

  test('ignores generic noise that lacks a bounded signal', () => {
    const results = [{
      title: 'Ten things to do near Bodega this weekend',
      url: 'https://example.com/listicle',
      description: 'A neighborhood guide with nearby shopping, parks, and casual recommendations.',
    }];

    assert.deepEqual(parseSignals(results, 'hospitality'), []);
  });

  test('returns explainable matches and notes', () => {
    const results = [{
      title: 'Bodega debuts a new chef tasting menu',
      url: 'https://example.com/bodega-menu',
      description: 'The restaurant says the new chef will lead a refreshed concept.',
    }];

    const matches = detectSignalMatches(results, 'hospitality');

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.kind, 'description-changed');
    assert.match(matches[0]?.label ?? '', /chef, menu, or concept change/i);

    const notes = buildNotes(results, buildSearchQuery({ name: 'Bodega', city: 'Toronto', monitorType: 'hospitality' }), matches);
    assert.match(notes, /description-changed/);
    assert.match(notes, /chef, menu, or concept change/);
  });
});
