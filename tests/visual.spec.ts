import { test, expect } from '@playwright/test';

// Visual regression tests compare against platform-specific screenshots.
// Skipped in CI — baselines are captured locally on macOS (darwin).
// To capture/update: npx playwright test tests/visual.spec.ts --update-snapshots
test.describe('Visual regression tests', () => {
  test.skip(!!process.env.CI, 'Visual baselines are platform-specific — run locally only');
  // Auth pre-seeded by global-setup.ts
  test.beforeEach(async (_) => { /* no-op: global-setup handles auth */ });

  test('homepage visual', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot('home.png', { maxDiffPixelRatio: 0.02 });
  });

  test('hot page visual', async ({ page }) => {
    await page.goto('/hot', { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot('hot.png', { maxDiffPixelRatio: 0.02 });
  });

  test('chat bar visual', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const chatBar = page.locator('[class*="chatPinned"]').first();
    if (await chatBar.isVisible()) {
      await expect(chatBar).toHaveScreenshot('chat-bar.png', { maxDiffPixelRatio: 0.02 });
    }
  });
});
