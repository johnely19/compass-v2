import { test, expect } from '@playwright/test';

test('chat widget has correct light background', async ({ page }) => {
  // Authenticate first by visiting /u/john2824
  await page.goto('/u/john2824', { waitUntil: 'networkidle' });

  // Navigate to home page
  await page.goto('/', { waitUntil: 'networkidle' });

  // Look for the chat textarea using a resilient placeholder locator
  const chatInput = page.getByPlaceholder(/anything/i);

  // Assert it exists and is visible
  await expect(chatInput).toBeVisible();

  // Check its computed background-color is a warm/light color (not dark)
  // rgb values where all channels > 200 means light color
  const bgColor = await chatInput.evaluate((el) => {
    const style = window.getComputedStyle(el);
    const match = style.backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
      };
    }
    return null;
  });

  expect(bgColor).not.toBeNull();

  // All channels should be > 200 for a light background
  const isLightBackground = bgColor!.r > 200 && bgColor!.g > 200 && bgColor!.b > 200;

  console.log('Chat input background color:', bgColor);

  expect(isLightBackground).toBe(true);
});