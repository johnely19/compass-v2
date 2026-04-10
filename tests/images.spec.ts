import { test, expect } from '@playwright/test';

test('all visible images load correctly', async ({ page }) => {
  // Authenticate as QA test user (fixture-backed, works in CI without Blob)
  await page.goto('/u/qa-test-user5506', { waitUntil: 'networkidle' });

  // Navigate to home page
  await page.goto('/', { waitUntil: 'networkidle' });

  // Find all img elements with src attributes
  const images = page.locator('img[src]');
  const count = await images.count();

  expect(count).toBeGreaterThan(0);

  const brokenImages: string[] = [];

  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    const src = await img.getAttribute('src');

    // Check if image is visible
    const isVisible = await img.isVisible();
    if (!isVisible) continue;

    // Wait for the image to potentially load
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

    // Get naturalWidth to check if image loaded
    const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);

    if (naturalWidth === 0) {
      brokenImages.push(src || 'unknown');
    }
  }

  if (brokenImages.length > 0) {
    console.log('Broken images found:', brokenImages);
  }

  expect(brokenImages).toHaveLength(0);
});