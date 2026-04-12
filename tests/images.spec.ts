import { test, expect, type Locator, type Page } from '@playwright/test';

const OWNER_AUTH_CODE = 'john2824';
const IMAGE_RICH_CONTEXT_KEY = 'trip:cottage-july-2026';
const IMAGE_RICH_PLACE_ID = 'ChIJCxjDu8c1K4gR33Dh5X2QMlc';

async function loginAsOwner(page: Page) {
  await page.goto(`/u/${OWNER_AUTH_CODE}`, { waitUntil: 'networkidle' });
}

async function expectPreviewBackgrounds(locator: Locator, minimumCards: number, minimumHeight = 0) {
  const count = await locator.count();
  expect(count).toBeGreaterThanOrEqual(minimumCards);

  for (let i = 0; i < Math.min(count, minimumCards); i++) {
    const preview = locator.nth(i);
    const backgroundImage = await preview.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backgroundImage).not.toBe('none');

    if (minimumHeight > 0) {
      const height = await preview.evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(minimumHeight);
    }
  }
}

async function expectLoadedGalleryImages(locator: Locator, minimumImages: number) {
  const count = await locator.count();
  expect(count).toBeGreaterThanOrEqual(minimumImages);

  for (let i = 0; i < minimumImages; i++) {
    const naturalWidth = await locator.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  }
}

test('homepage place cards show preview images for the Ontario Cottage context', async ({ page }) => {
  await loginAsOwner(page);
  await page.evaluate((contextKey) => {
    window.localStorage.setItem('compass-active-context', contextKey);
  }, IMAGE_RICH_CONTEXT_KEY);
  await page.goto('/', { waitUntil: 'networkidle' });

  const previews = page.locator('.place-card-image');
  await expectPreviewBackgrounds(previews, 3, 150);
});

test('review cards show preview images for the Ontario Cottage context', async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/review/${encodeURIComponent(IMAGE_RICH_CONTEXT_KEY)}`, { waitUntil: 'networkidle' });

  const previews = page.locator('.accomm-card-hero');
  await expectPreviewBackgrounds(previews, 4);
});

test('image-rich place cards expose at least three gallery images when available', async ({ page }) => {
  await page.goto(`/placecards/${IMAGE_RICH_PLACE_ID}`, { waitUntil: 'networkidle' });

  const galleryImages = page.locator('.place-detail-v2 .photo-gallery-item img');
  await expectLoadedGalleryImages(galleryImages, 3);
});
