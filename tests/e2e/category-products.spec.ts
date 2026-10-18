import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, productId, sql } from './helpers';

const CATEGORY = 'a0000000-0000-7000-8000-0000000ca001';

test('each category has an edit button and a products button that lists its products', async ({ page }) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.categories }).click();

  await page.getByTestId(`category-products-${CATEGORY}`).click();
  await expect(page.getByTestId(`category-product-${productId(1)}`)).toBeVisible();
  const count = Number(
    sql(`select count(*) from products where category_id = '${CATEGORY}' and deleted_at is null`),
  );
  await expect(page.locator('[data-testid^="category-product-"]')).toHaveCount(count);
  await page.getByTestId(`category-product-${productId(1)}`).click();
  await expect(page).toHaveURL(new RegExp(`#/products/${productId(1)}$`));

  await page.getByRole('button', { name: strings.nav.categories }).click();
  await page.getByTestId(`edit-category-${CATEGORY}`).click();
  await expect(page.getByTestId('category-name')).toBeVisible();
});
