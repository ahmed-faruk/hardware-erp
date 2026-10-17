import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

test('@smoke first run shows the login form (no activation code), in Arabic and right to left', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('login-username')).toBeVisible();
  await expect(page.getByTestId('login-password')).toBeVisible();
  await expect(page.getByRole('heading', { name: strings.setup.title })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('login-submit')).toBeDisabled();
});
