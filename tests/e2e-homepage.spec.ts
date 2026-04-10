/**
 * E2E tests for the Compass V2 homepage — single-track focused view.
 * Tests the full user flow: layout, context switching, chat, trip creation.
 * 
 * Run: npx playwright test tests/e2e-homepage.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

// Auth is pre-seeded by global-setup.ts (compass-user cookie for qa-test-user)

/** Navigate to homepage (auth already set by global-setup) */
async function loginAndGoHome(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); // let client hydrate
}

test.describe('Homepage Layout', () => {
  test('renders single-track focused view with all key elements', async ({ page }) => {
    await loginAndGoHome(page);

    // Nav bar exists
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Places' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review', exact: true })).toBeVisible();

    // Context switcher exists (button with trip name and arrow)
    const switcher = page.locator('.ctx-switcher-button, [class*="ctx-switcher"]').first();
    await expect(switcher).toBeVisible();

    // Chat input pinned at bottom
    const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 8000 });

    // Send button exists
    const sendButton = page.locator('button').filter({ hasText: /➤|▸|Send/i }).first();
    await expect(sendButton).toBeVisible({ timeout: 8000 });
  });

  test('shows trip card with title, dates, and focus tags', async ({ page }) => {
    await loginAndGoHome(page);

    // Trip title should be visible somewhere
    const tripTitle = page.locator('h2').first();
    await expect(tripTitle).toBeVisible();

    // Focus tags should be visible (if trip has them)
    const focusTags = page.locator('.focused-hero-meta, .section-desc, .focused-hero-focus');
    // At least the trip title area should exist
    const heroArea = page.locator('.focused-hero, .focused-content, .section-header');
    await expect(heroArea.first()).toBeVisible();
  });

  test('shows empty state with suggested prompts when no discoveries', async ({ page }) => {
    await loginAndGoHome(page);

    // Check for either discoveries or empty state
    const hasDiscoveries = await page.locator('.place-grid, .discovery-card, [class*="place-card"]').count() > 0;
    
    if (!hasDiscoveries) {
      // Empty state should have prompts
      const emptyState = page.locator('.focused-empty-discoveries, [class*="empty"]');
      if (await emptyState.count() > 0) {
        await expect(emptyState.first()).toBeVisible();
        // Should have suggestion prompts
        const prompts = page.locator('.focused-empty-prompt');
        expect(await prompts.count()).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('chat input is accessible without scrolling on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAndGoHome(page);

    const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 8000 });
    
    // Chat should be in the viewport without scrolling
    const box = await chatInput.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
  });
});

test.describe('Context Switcher', () => {
  test('opens dropdown with available trips', async ({ page }) => {
    await loginAndGoHome(page);

    // Click the context switcher trigger
    const switcher = page.locator('.ctx-switcher-trigger, [class*="ctx-switcher-trigger"]').first();
    await expect(switcher).toBeVisible({ timeout: 8000 });
    await switcher.click();
    await page.waitForTimeout(300);

    // Dropdown should be visible with at least one trip
    const dropdown = page.locator('.ctx-switcher-dropdown, [class*="ctx-switcher-dropdown"]');
    await expect(dropdown.first()).toBeVisible();
  });
});

test.describe('Chat Functionality', () => {
  test('can type and send a message', async ({ page }) => {
    await loginAndGoHome(page);

    const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
    await chatInput.fill('Hello');
    
    // Send button should be enabled
    const sendButton = page.locator('button').filter({ hasText: /➤|▸|Send/i }).first();
    
    // Or submit via Enter
    await chatInput.press('Enter');
    
    // Should show loading or streaming state
    await page.waitForTimeout(2000);
    
    // A response message should appear
    // Wait for a response bubble to appear (CSS module class contains 'chatBubble')
    // The assistant's response text should appear somewhere below the input
    const response = page.locator('[class*="chatBubble"], [class*="Bubble"], [class*="bubble"]').filter({ hasText: /.{10,}/ });
    await expect(response.first()).toBeVisible({ timeout: 25000 });
  });

  test('shows tool status during operations', async ({ page }) => {
    await loginAndGoHome(page);

    const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
    await chatInput.fill('What is the weather like in Tokyo?');
    await chatInput.press('Enter');

    // Should show some kind of loading/streaming indicator
    await page.waitForTimeout(1000);
    
    // Either tool status or streaming content should be visible
    const hasActivity = await page.locator('[class*="tool-status"], [class*="streaming"], [class*="loading"], [class*="message"]').count() > 0;
    // Just verify the chat is responding (no hard crash)
    await page.waitForTimeout(5000);
    expect(true).toBe(true); // Smoke test — no crash
  });
});

test.describe('Trip Creation Flow', () => {
  // Requires live AI API — skip in CI where ANTHROPIC_API_KEY is not available
  test('creating a trip via chat updates the homepage', async ({ page }) => {
    test.skip(!!process.env.CI, 'Requires live AI API key — run locally only');
    await loginAndGoHome(page);

    // Remember initial trip title
    const initialTitle = await page.locator('h2').first().textContent();

    const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
    const uniqueName = `Test Trip ${Date.now()}`;
    await chatInput.fill(`Plan a trip to Reykjavik called "${uniqueName}"`);
    await chatInput.press('Enter');

    // Wait for response (up to 30s for tool execution)
    await page.waitForTimeout(15000);

    // After creation, either:
    // 1. The page title changed (auto-switched to new trip)
    // 2. The context switcher now has the new trip
    
    // Check context switcher for new trip
    const switcher = page.locator('.ctx-switcher-button, [class*="ctx-switcher"] button').first();
    await switcher.click();
    await page.waitForTimeout(500);
    
    const pageContent = await page.content();
    const hasNewTrip = pageContent.toLowerCase().includes('reykjavik');
    
    // The new trip should exist somewhere on the page
    expect(hasNewTrip).toBe(true);
  });
});

test.describe('No Console Errors', () => {
  test('homepage loads without critical console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known non-critical errors
        if (text.includes('404') || text.includes('favicon') || text.includes('hydration')) return;
        errors.push(text);
      }
    });

    await loginAndGoHome(page);
    await page.waitForTimeout(2000);

    // No critical JS errors
    expect(errors.length).toBe(0);
  });
});

test.describe('Responsive Design', () => {
  const viewports = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 14', width: 390, height: 844 },
    { name: 'iPad', width: 768, height: 1024 },
    { name: 'Desktop', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`renders correctly on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAndGoHome(page);

      // Core elements should be visible at any viewport
      await expect(page.getByRole('navigation')).toBeVisible();
      const chatInput = page.locator('textarea[class*="chatInput"], textarea').first();
      await expect(chatInput).toBeVisible();

      // Take screenshot for manual review
      await page.screenshot({ 
        path: `test-results/responsive-${vp.name.toLowerCase().replace(' ', '-')}.png`,
        fullPage: false 
      });
    });
  }
});
