import { test, expect } from '@playwright/test';

const PAGES = ['/', '/placecards', '/hot', '/review', '/admin'];

test.describe('Page load and console error tests', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as the QA test user (has static fixture data — works in CI without Blob)
    await page.goto('/u/qa-test-user5506', { waitUntil: 'networkidle' });
  });

  for (const path of PAGES) {
    test(`page ${path} loads without hydration errors`, async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      const response = await page.goto(path, { waitUntil: 'networkidle' });

      // Assert HTTP 200
      expect(response?.status()).toBe(200);

      // Log all console errors for debugging
      if (consoleErrors.length > 0) {
        console.log(`Page ${path} console errors:`, consoleErrors);
      }

      // FAIL if any console.error contains 'Hydration' or 'hydration'
      const hydrationErrors = consoleErrors.filter(
        (err) => err.toLowerCase().includes('hydration')
      );
      expect(hydrationErrors).toHaveLength(0);

      // FAIL if any console.error contains 'Unhandled' or 'unhandled'
      const unhandledErrors = consoleErrors.filter(
        (err) => err.toLowerCase().includes('unhandled')
      );
      expect(unhandledErrors).toHaveLength(0);
    });
  }
});