import { test, expect, devices, type Page, type Browser } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3002';

async function seedJohnCookie(page: Page) {
  await page.context().addCookies([
    {
      name: 'compass-user',
      value: 'john',
      url: BASE_URL,
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
    baseURL: BASE_URL,
    storageState: undefined,
  });
  const page = await context.newPage();
  await seedJohnCookie(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  return { context, page };
}

async function expectCardCenterToNavigate(page: Page, mode: 'mouse' | 'tap' = 'mouse') {
  const firstCard = page.locator('a.place-card').first();
  await expect(firstCard).toBeVisible();

  const box = await firstCard.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const topElement = await page.evaluate(([clickX, clickY]) => {
    const node = document.elementFromPoint(clickX, clickY);
    if (!node) return null;
    return {
      tag: node.tagName,
      className: node instanceof HTMLElement ? node.className : '',
    };
  }, [x, y]);

  expect(topElement?.className ?? '').not.toContain('ChatWidget');

  if (mode === 'tap') {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
  await page.waitForURL(/\/placecards\//);
  await expect(page).toHaveURL(/\/placecards\//);
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

  test('homepage place cards keep the fixed click-shell structure and controls visible', async ({ page }) => {
    await openHomepageAsJohn(page);

    const firstCard = page.locator('a.place-card').first();
    await expect(firstCard).toBeVisible();

    const cardShell = firstCard.locator('xpath=..');
    await expect(cardShell).toHaveClass(/place-card-shell/);

    const triageButtons = cardShell.locator('.place-card-triage-overlay .triage-btn');
    await expect(triageButtons).toHaveCount(2);
    await expect(triageButtons.first()).toBeVisible();
    await expect(cardShell.getByRole('button', { name: /chat about/i })).toBeVisible();

    const detailLink = cardShell.locator('.place-card-detail-link');
    await expect(detailLink).toBeVisible();
    await expect(detailLink).toHaveAttribute('href', /\/placecards\/.+\?context=/);

    const mapsButton = cardShell.locator('.place-card-maps');
    await expect(mapsButton).toBeVisible();
    await expect(mapsButton).toHaveText(/maps/i);
    await expect(mapsButton.evaluate((el) => el.tagName)).resolves.toBe('BUTTON');
  });

  test('clicking the visible center of the first homepage place card navigates to detail', async ({ page }) => {
    await openHomepageAsJohn(page);
    await expectCardCenterToNavigate(page, 'mouse');
  });

  test('clicking footer whitespace on the first homepage place card still navigates to detail', async ({ page }) => {
    await openHomepageAsJohn(page);

    const firstCard = page.locator('a.place-card').first();
    await expect(firstCard).toBeVisible();

    const cardShell = firstCard.locator('xpath=..');
    await expect(cardShell).toHaveClass(/place-card-shell/);

    const footer = cardShell.locator('.place-card-footer');
    await expect(footer).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/placecards\//),
      footer.click({ position: { x: 6, y: 10 } }),
    ]);

    await expect(page).toHaveURL(/\/placecards\//);
  });
});

test('homepage readiness for john on mobile: tapping the visible center of the first place card navigates to detail', async ({ browser }) => {
  const { context, page } = await newJohnMobilePage(browser);

  try {
    await expectCardCenterToNavigate(page, 'tap');
  } finally {
    await context.close();
  }
});
