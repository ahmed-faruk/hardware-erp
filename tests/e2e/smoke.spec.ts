import { expect, test } from '@playwright/test';

test('@smoke home page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toBeVisible();
});
