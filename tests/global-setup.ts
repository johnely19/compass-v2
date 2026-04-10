/**
 * Playwright global setup — pre-authenticate as qa-test-user.
 *
 * Sets the compass-user cookie directly so tests don't go through the
 * /u/[code] → onboarding redirect flow, which requires Blob access to
 * determine whether to redirect to / or show onboarding.
 *
 * The cookie value is just the userId ('qa-test-user'), matching what
 * /u/[code] sets via COOKIE_NAME in app/_lib/user.ts.
 */
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3002';

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });

  // Set the auth cookie directly — bypasses onboarding redirect.
  // Use the baseURL to navigate first, then set cookies, so domain is inferred correctly.
  const page = await context.newPage();
  // Navigate to the server first so cookie domain is established
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await context.addCookies([
    {
      name: 'compass-user',
      value: 'qa-test-user',
      url: baseURL,
    },
  ]);

  // Verify the auth works by hitting /api/auth
  const res = await page.request.get('/api/auth');
  const body = await res.json().catch(() => null);
  if (!body?.user) {
    console.warn('[global-setup] Warning: /api/auth returned no user. Tests may fail.');
  } else {
    console.log('[global-setup] Auth OK:', body.user.id);
  }

  // Save the storage state so all tests can reuse it
  await context.storageState({ path: 'tests/.auth-state.json' });
  await browser.close();
}
