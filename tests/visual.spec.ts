import { test, expect } from '@playwright/test';

test.describe('Visual regression tests', () => {
  test.beforeEach(async ({ page }) => {
    // Auth by visiting /u/john2824
    await page.goto('/u/john2824', { waitUntil: 'networkidle' });
  });

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
    const chatBar = page.locator('[class*="chatCollapsed"]').first();
    if (await chatBar.isVisible()) {
      await expect(chatBar).toHaveScreenshot('chat-bar.png', { maxDiffPixelRatio: 0.02 });
    }
  });
});
