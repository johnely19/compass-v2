import { test, expect } from '@playwright/test';

const HOMEPAGE_HTML_BUDGET_BYTES = 50 * 1024;

test('signed-in homepage HTML stays under the mobile SSR budget', async ({ request }) => {
  const response = await request.get('/', {
    headers: {
      Cookie: 'compass-user=john',
    },
  });

  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  const bytes = Buffer.byteLength(html, 'utf8');

  expect(bytes, `homepage HTML budget exceeded: ${bytes} bytes`).toBeLessThan(HOMEPAGE_HTML_BUDGET_BYTES);
});
