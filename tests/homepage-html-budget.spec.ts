import { test, expect } from '@playwright/test';

const HTML_BUDGET_BYTES = 50 * 1024;

test('homepage HTML stays under the mobile budget for john', async ({ request, baseURL }) => {
  test.skip(!baseURL, 'baseURL is required');

  const response = await request.get('/', {
    headers: {
      cookie: 'compass-user=john',
    },
  });

  expect(response.ok()).toBeTruthy();

  const html = await response.text();
  const bytes = Buffer.byteLength(html, 'utf8');

  expect(bytes, `Homepage HTML was ${bytes} bytes`).toBeLessThan(HTML_BUDGET_BYTES);
  expect(html).toContain('focused-content');
  expect(html).toContain('NYC Solo Trip');
});

test('homepage still loads discovery cards and place-card navigation for john', async ({ page, baseURL }) => {
  test.skip(!baseURL, 'baseURL is required');

  await page.context().addCookies([{ name: 'compass-user', value: 'john', url: baseURL }]);
  await page.goto('/', { waitUntil: 'networkidle' });

  const firstCard = page.locator('.place-card').first();
  await expect(firstCard).toBeVisible();

  await firstCard.click();
  await expect(page).toHaveURL(/\/placecards\//);
});
