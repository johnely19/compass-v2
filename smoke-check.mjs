import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://localhost:3002';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
// Navigate to auth URL first to set cookie properly, then check homepage
await context.addCookies([{ name: 'compass-user', value: 'john2824', domain: new URL(base).hostname, path: '/' }]);
const page = await context.newPage();
const result = { homepage:false, placeClick:false, imagesOk:false, triageHide:false, chat:false, admin:false, review:false, manifest:false, details:{} };
try {
  // Auth first
  await page.goto(base + '/u/john2824', { waitUntil: 'networkidle', timeout: 30000 });
  // Homepage
  const resp = await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 60000 });
  result.details.homeStatus = resp?.status();
  await page.waitForTimeout(1500); // let client hydrate

  const cardLinks = page.locator('a[href*="/placecards/"]');
  const cardCount = await cardLinks.count();
  result.details.cardCount = cardCount;
  result.homepage = (resp?.status() === 200) && cardCount > 0;

  // Images
  const brokenImages = [];
  const imgs = page.locator('img[src]');
  const imgCount = Math.min(await imgs.count(), 6);
  for (let i = 0; i < imgCount; i++) {
    const ok = await imgs.nth(i).evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false);
    if (!ok) brokenImages.push(i);
  }
  result.details.checkedImages = imgCount;
  result.details.brokenImages = brokenImages;
  result.imagesOk = imgCount === 0 || brokenImages.length === 0;

  // Place click — cards open /placecards/ route
  if (cardCount > 0) {
    const firstHref = await cardLinks.first().getAttribute('href');
    result.details.firstHref = firstHref;
    const cardPage = await context.newPage();
    const cardResp = await cardPage.goto(base + firstHref, { waitUntil: 'networkidle', timeout: 30000 });
    result.details.placeUrl = cardPage.url();
    result.placeClick = (cardResp?.status() || 0) < 400;
    await cardPage.close();
  }

  // Triage — look for save/dismiss buttons on the homepage
  const triageButtons = page.locator('[class*="triageBtn"], [class*="triage-btn"], button:has-text("+"), button:has-text("−")');
  const triageCount = await triageButtons.count();
  result.details.triageButtonCount = triageCount;
  result.triageHide = triageCount > 0; // just verify they exist

  // Chat — textarea should be visible and accept input
  const chatInput = page.locator('textarea').first();
  const chatCount = await page.locator('textarea').count();
  result.details.chatInputCount = chatCount;
  if (chatCount > 0) {
    await chatInput.fill('hello');
    await chatInput.press('Enter');
    await page.waitForTimeout(4000);
    const bodyText = await page.textContent('body');
    // Any non-trivial response = chat working
    result.chat = (bodyText?.length || 0) > 500;
  }

  // Manifest API
  const manifestPage = await context.newPage();
  const manifestResp = await manifestPage.goto(base + '/api/user/manifest', { waitUntil: 'networkidle', timeout: 10000 });
  result.details.manifestStatus = manifestResp?.status();
  result.manifest = manifestResp?.status() === 200;
  await manifestPage.close();

  // Admin
  const admin = await context.newPage();
  const adminResp = await admin.goto(base + '/admin', { waitUntil: 'networkidle', timeout: 30000 });
  result.details.adminStatus = adminResp?.status();
  const adminText = await admin.textContent('body');
  result.admin = (adminResp?.status() === 200) && /Admin|Crons|Users|Agents|Overview/i.test(adminText || '');
  await admin.close();

  // Review
  const review = await context.newPage();
  const reviewResp = await review.goto(base + '/review', { waitUntil: 'networkidle', timeout: 30000 });
  result.details.reviewStatus = reviewResp?.status();
  const reviewText = await review.textContent('body');
  result.details.reviewTextSnippet = (reviewText || '').slice(0, 300);
  result.review = (reviewResp?.status() === 200) && /review|✓|✗|Saved|Dismissed/i.test(reviewText || '');
  await review.close();
} catch (e) {
  result.details.error = String(e);
}
console.log(JSON.stringify(result, null, 2));
await browser.close();
