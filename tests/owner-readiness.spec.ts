import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const OWNER_AUTH_CODE = 'john2824';
const CHECKS = [
  {
    path: '/',
    ready: (page: Page) => page.locator('a[href*="/placecards/"]').first(),
  },
  {
    path: '/review',
    ready: (page: Page) => page.locator('.review-hub-card').first(),
  },
  {
    path: '/admin',
    ready: (page: Page) => page.getByRole('heading', { name: 'Admin' }),
  },
] as const;

async function loginAsOwner(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`/u/${OWNER_AUTH_CODE}`, { waitUntil: 'networkidle' });
  await page.close();
}

test('owner readiness routes stay healthy across repeated loads', async ({ context }) => {
  test.setTimeout(90_000);
  await loginAsOwner(context);

  for (let iteration = 0; iteration < 3; iteration++) {
    for (const check of CHECKS) {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const response = await page.goto(check.path, { waitUntil: 'networkidle', timeout: 30_000 });

      expect(response?.status(), `${check.path} returned an unexpected status on pass ${iteration + 1}`).toBe(200);
      await expect(check.ready(page), `${check.path} never reached its ready UI on pass ${iteration + 1}`).toBeVisible();
      expect(pageErrors, `${check.path} triggered uncaught page errors on pass ${iteration + 1}`).toEqual([]);

      await page.close();
    }
  }
});
