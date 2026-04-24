import { test, expect, devices, type Page, type Browser } from '@playwright/test';

async function seedJohnCookie(page: Page) {
  await page.context().addCookies([
    {
      name: 'compass-user',
      value: 'john',
      url: 'http://localhost:3002',
    },
  ]);
}

async function openHomepageAsJohn(page: Page) {
  await seedJohnCookie(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

async function newJohnMobilePage(browser: Browser) {
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    baseURL: 'http://localhost:3002',
    storageState: undefined,
  });
  const page = await context.newPage();
  await seedJohnCookie(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  return { context, page };
}

test.describe('homepage readiness for john', () => {
  test('focused homepage still exposes multiple contexts via the switcher', async ({ page }) => {
    await openHomepageAsJohn(page);

    const switcher = page.locator('.ctx-switcher-trigger');
    await expect(switcher).toBeVisible();
    await expect(page.locator('.focused-hero-title').first()).toBeVisible();

    await switcher.click();

    const options = page.locator('.ctx-switcher-option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('.ctx-switcher-group-label').first()).toContainText(/Trips|Outings|Radars/);
  });

  test('homepage place cards keep triage, chat, and maps controls visible', async ({ page }) => {
    await openHomepageAsJohn(page);

    const firstCard = page.locator('a.place-card').first();
    await expect(firstCard).toBeVisible();

    const cardShell = firstCard.locator('xpath=..');
    const triageButtons = cardShell.locator('.place-card-triage-overlay .triage-btn');
    await expect(triageButtons).toHaveCount(2);
    await expect(triageButtons.first()).toBeVisible();
    await expect(cardShell.getByRole('button', { name: /chat about/i })).toBeVisible();

    const mapsLink = cardShell.locator('.place-card-maps');
    await expect(mapsLink).toBeVisible();
    await expect(mapsLink).toHaveAttribute('href', /google\.com\/maps/);
    await expect(mapsLink).toHaveAttribute('target', '_blank');
  });

  test('clicking the first homepage place card navigates to detail', async ({ page }) => {
    await openHomepageAsJohn(page);

    const firstCard = page.locator('a.place-card').first();
    await expect(firstCard).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/placecards\//),
      firstCard.click({ position: { x: 24, y: 24 } }),
    ]);

    await expect(page).toHaveURL(/\/placecards\//);
  });
});

test('homepage readiness for john on mobile: tapping the first place card navigates to detail', async ({ browser }) => {
  const { context, page } = await newJohnMobilePage(browser);

  try {
    const firstCard = page.locator('a.place-card').first();
    await expect(firstCard).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/placecards\//),
      firstCard.tap({ position: { x: 24, y: 24 } }),
    ]);

    await expect(page).toHaveURL(/\/placecards\//);
  } finally {
    await context.close();
  }
});
