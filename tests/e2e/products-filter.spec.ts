import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture } from './helpers';

const CATEGORY = 'a0000000-0000-7000-8000-0000000ca001';

test('the products filters are still there after a product is opened and saved', async ({ page }) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: strings.nav.products }).click();
  await page.getByTestId('product-category-filter').selectOption(CATEGORY);
  await page.getByTestId('product-search').fill('Test product');
  await page.getByText('Test product 2', { exact: true }).click();
  await expect(page.getByTestId('product-name')).toBeVisible();
  await page.getByTestId('save-product').click();
  await expect(page.getByTestId('product-category-filter')).toHaveValue(CATEGORY);
  await expect(page.getByTestId('product-search')).toHaveValue('Test product');
});
