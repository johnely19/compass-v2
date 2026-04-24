import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as PlaceCardModule from '../app/_components/PlaceCard';

type PlaceCardComponent = React.ComponentType<Record<string, unknown>>;
type PlaceCardModuleShape = {
  default?: PlaceCardComponent | { default?: PlaceCardComponent };
};

const placeCardExport = PlaceCardModule as unknown as PlaceCardModuleShape;
const PlaceCard =
  placeCardExport.default && typeof placeCardExport.default === 'object' && 'default' in placeCardExport.default
    ? placeCardExport.default.default
    : placeCardExport.default;

function renderPlaceCard() {
  return renderToStaticMarkup(
    React.createElement(PlaceCard, {
      discovery: {
        id: 'disco-1',
        place_id: 'ChIJ123',
        name: 'Test Place',
        type: 'restaurant',
        rating: 4.5,
      },
      contextKey: 'trip:test-trip',
      userId: 'john',
    }),
  );
}

describe('homepage place-card links', () => {
  test('keeps homepage card anchors app-local and exposes Maps as a button action', () => {
    const html = renderPlaceCard();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    assert.equal(hrefs.length, 2, 'expected the card to render only the main card link and the detail footer link');
    assert.ok(hrefs.every((href) => href.startsWith('/placecards/')), 'expected every rendered card link to stay app-local');
    assert.match(html, /class="place-card-maps"/, 'expected the Maps action to stay visible on the card');
    assert.match(html, /<button type="button" class="place-card-maps"/, 'expected the Maps action to render as a button, not as a second external anchor');
    assert.doesNotMatch(html, /https:\/\/www\.google\.com\/maps\/place\//, 'expected no Google Maps href to be rendered inside the homepage card');
  });
});
