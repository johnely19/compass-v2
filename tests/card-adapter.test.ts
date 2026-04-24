import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptCard } from '../app/_lib/card-adapter';

describe('adaptCard', () => {
  test('preserves top-level fields from lightweight stub place cards', () => {
    const card = adaptCard({
      place_id: 'ChIJYRqEV39bwokRpz-hF0GXgaA',
      name: 'Archestratus Books + Foods',
      type: 'bookshop-cafe',
      address: '160 Huron St, Brooklyn, NY 11222',
      city: '',
      rating: 4.8,
      hero_image: null,
      stub: true,
    }, {
      images: [
        { path: 'https://example.com/photo.jpg', category: 'general' },
      ],
    });

    assert.equal(card.name, 'Archestratus Books + Foods');
    assert.equal(card.place_id, 'ChIJYRqEV39bwokRpz-hF0GXgaA');
    assert.equal(card.type, 'restaurant');
    assert.equal(card.data.address, '160 Huron St, Brooklyn, NY 11222');
    assert.equal(card.data.rating, 4.8);
    assert.deepEqual(card.data.images, [
      { path: 'https://example.com/photo.jpg', category: 'general' },
    ]);
  });
});
