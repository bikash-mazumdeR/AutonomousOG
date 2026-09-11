import { test, expect } from '@playwright/test';

test.describe('Baseline Application Health', () => {
  test('Application should be reachable', async ({ page }) => {
    // Navigate to the AUT_BASE_URL (defaults to localhost:3000 in config)
    const res = await page.goto('/');
    
    // Ensure the page loaded successfully
    expect(res?.status()).toBeLessThan(400);
  });
});
