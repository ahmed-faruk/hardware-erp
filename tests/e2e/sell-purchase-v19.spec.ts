import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { formatQty } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const CASHIER_CATEGORY = 'a0000000-0000-7000-8000-0000000ca001';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const tag = (): string =>
  randomUUID()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 5);

async function startSelling(page: Page): Promise<void> {
  const f = newCashierFixture();
  await loginAs(page, f, 'cashier');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

async function openPurchase(page: Page): Promise<void> {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await expect(page.getByTestId('purchase-scan')).toBeVisible();
}

async function scan(page: Page, code: string): Promise<void> {
  await page.getByTestId('purchase-scan').fill(code);
  await page.getByTestId('purchase-scan').press('Enter');
}

test.describe('v19: purchases, category search, cursor', () => {
  test('purchases: a new item goes to the top; scanning an item again adds one and moves it to the top', async ({
    page,
  }) => {
    await openPurchase(page);
    await scan(page, '9000002');
    await scan(page, '9000003');
    const lines = page.locator('[data-testid="purchase-line"]');
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText('Test product 3');
    await scan(page, '9000002');
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText('Test product 2');
    await expect(page.getByTestId('pl-qty-1')).toHaveValue('2');
  });

  test('purchases: the new-item dialog takes the purchase price and the sale price; the line starts with the purchase price', async ({
    page,
  }) => {
    await openPurchase(page);
    const name = `Quick ${tag()}`;
    await page.getByTestId('purchase-new-product').click();
    await page.getByTestId('qa-name').fill(name);
    await page.getByTestId('qa-cost').fill('7.50');
    await page.getByTestId('qa-price').fill('10');
    await page.getByTestId('qa-save').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.getByTestId('pl-cost-0')).toHaveValue('7.50');
    await expect
      .poll(() => sql(`select price || ':' || unit_cost from products where name = '${name}'`), {
        timeout: 60_000,
      })
      .toBe('1000:750');
  });

  test('sell: a chosen category limits the search; a second tap searches everywhere; a barcode is found in any category', async ({
    page,
  }) => {
    const t = tag();
    const cat = randomUUID();
    const inside = randomUUID();
    const outside = randomUUID();
    const code = `77${Date.now()}`.slice(0, 13);
    sql(
      `insert into categories (id, company_id, name, color_token, icon, sort) values ('${cat}', '${COMPANY}', 'Cat ${t}', 'cat-3', 'paint-roller', 5)`,
    );
    sql(
      `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals, category_id) values ('${inside}', '${COMPANY}', 'CI${t}', 'Word${t} inside', 'pcs', 1000, 500, 0, '${cat}'), ('${outside}', '${COMPANY}', 'CO${t}', 'Word${t} outside', 'pcs', 1000, 500, 0, '${CASHIER_CATEGORY}')`,
    );
    sql(
      `insert into barcodes (id, company_id, product_id, code) values ('${randomUUID()}', '${COMPANY}', '${outside}', '${code}')`,
    );
    await startSelling(page);
    const search = page.getByTestId('sell-search');
    const tile = (id: string) => page.locator(`[data-testid="tile-${id}"]:visible`).first();
    const tiles = (id: string) => page.locator(`[data-testid="tile-${id}"]`);
    const catButton = vis(page, `cat-${cat}`);

    // no category: both
    await search.fill(`Word${t}`);
    await expect(tile(inside)).toBeVisible({ timeout: 30_000 });
    await expect(tile(outside)).toBeVisible();
    // the category: only the one inside, by the start or the middle of the words
    await catButton.click();
    await expect(catButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tiles(outside)).toHaveCount(0);
    await expect(tile(inside)).toBeVisible();
    await search.fill(`ord${t} nsi`);
    await expect(tile(inside)).toBeVisible();
    await expect(tiles(outside)).toHaveCount(0);
    // Enter adds the match inside the category
    await search.fill(`Word${t}`);
    await search.press('Enter');
    await expect(vis(page, 'line-0')).toContainText(`Word${t} inside`);
    // a barcode of a product of another category is still found
    await search.fill(code);
    await search.press('Enter');
    await expect(vis(page, 'line-1')).toContainText(`Word${t} outside`);
    // a second tap on the category: everywhere again
    await catButton.click();
    await expect(catButton).toHaveAttribute('aria-pressed', 'false');
    await search.fill(`Word${t}`);
    await expect(tile(outside)).toBeVisible();
    await expect(tile(inside)).toBeVisible();
  });

  test('sell: after a quantity change (pad, + or -) the cursor is back in the search box', async ({
    page,
  }) => {
    await startSelling(page);
    const search = page.getByTestId('sell-search');
    await page
      .locator(`[data-testid="tile-${productId(1)}"] button`)
      .first()
      .click();
    await vis(page, 'qty-0').click();
    await expect(page.getByTestId('num-display')).toBeVisible();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(vis(page, 'qty-0')).toHaveText(formatQty(3000));
    await expect(search).toBeFocused();
    await vis(page, 'step-up-0').click();
    await expect(vis(page, 'qty-0')).toHaveText(formatQty(4000));
    await expect(search).toBeFocused();
    await vis(page, 'step-down-0').click();
    await expect(vis(page, 'qty-0')).toHaveText(formatQty(3000));
    await expect(search).toBeFocused();
  });
});
