import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function renderPlaceCardDetail(props: Record<string, unknown>) {
  const imported = await import('../app/_components/PlaceCardDetail');
  const PlaceCardDetail = ((imported.default as { default?: unknown })?.default ?? imported.default) as React.ComponentType<Record<string, unknown>>;
  return renderToStaticMarkup(React.createElement(PlaceCardDetail, props));
}

describe('place card View in Maps action (issue #326)', () => {
  test('renders the Maps action even when the card has no address fields', async () => {
    const html = await renderPlaceCardDetail({
      card: {
        place_id: 'ChIJAddresslessPlace123',
        name: 'Addressless Place',
        type: 'restaurant',
        data: {
          description: 'A place card reached from discovery data without a rendered address.',
          highlights: [],
          images: [],
        },
      },
    });

    assert.match(html, /View in Maps/);
    assert.match(
      html,
      /href="https:\/\/www\.google\.com\/maps\/place\/\?q=place_id:ChIJAddresslessPlace123"/
    );
  });
});
