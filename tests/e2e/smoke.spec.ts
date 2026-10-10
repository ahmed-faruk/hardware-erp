import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

test('@smoke first run shows device activation, in Arabic and right to left', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('activation-code')).toBeVisible();
  await expect(page.getByRole('heading', { name: strings.setup.title })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('activate')).toBeDisabled();
});
