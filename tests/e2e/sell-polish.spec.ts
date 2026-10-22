import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const CUSTOMER = 'a0000000-0000-7000-8000-000000000c01';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const tile = (page: Page, n: number) => page.locator(`[data-testid="tile-${productId(n)}"] button`).first();

async function start(page: Page): Promise<CashierFixture> {
  const f = newCashierFixture();
  await loginAs(page, f, 'cashier');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  return f;
}

test.describe('sell screen and expenses polish', () => {
  test('a part of a word finds the product; adding it empties the search box and keeps the cursor there', async ({
    page,
  }) => {
    await start(page);
    const search = page.getByTestId('sell-search');
    await search.fill('roduct 3');
    await expect(page.getByTestId(`tile-${productId(3)}`)).toBeVisible();
    await tile(page, 3).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await search.fill('oduct 2');
    await page.keyboard.press('Enter');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
  });

  test('the cart lists the product touched last first', async ({ page }) => {
    await start(page);
    await tile(page, 2).click();
    await tile(page, 3).click();
    await expect(vis(page, 'cart').locator('li').first()).toContainText('Test product 3');
    await tile(page, 2).click();
    await expect(vis(page, 'cart').locator('li').first()).toContainText('Test product 2');
    await expect(vis(page, 'cart').locator('li')).toHaveCount(2);
  });

  test('a held invoice shows its customer, a written name, or that it has none', async ({ page }) => {
    await start(page);
    // 1. with a customer: held at once, no name asked
    await tile(page, 3).click();
    await vis(page, 'pay').click();
    await page.getByTestId('choose-customer').click();
    await page.getByTestId(`customer-${CUSTOMER}`).click();
    await page.getByTestId('pay-back').click();
    await page.keyboard.press('F8');
    await expect(page.getByTestId('hold-name')).toHaveCount(0);
    await expect(vis(page, 'held')).toHaveText('1');
    // 2. no customer: a written name
    await tile(page, 2).click();
    await vis(page, 'hold').click();
    await page.getByTestId('hold-name').fill('أبو أحمد النجار');
    await page.getByTestId('hold-confirm').click();
    await expect(vis(page, 'held')).toHaveText('2');
    // 3. no customer, no name
    await tile(page, 1).click();
    await page.keyboard.press('F8');
    await page.getByTestId('hold-confirm').click();
    await expect(vis(page, 'held')).toHaveText('3');
    await page.keyboard.press('Shift+F8');
    await expect(page.getByTestId('held-list')).toContainText('Test Customer');
    await expect(page.getByTestId('held-list')).toContainText('أبو أحمد النجار');
    await expect(page.getByTestId('held-list')).toContainText(strings.sell.noCustomer);
  });

  test('the cashier writes a note with an expense', async ({ page }) => {
    const f = await start(page);
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-expense').click();
    await page.getByTestId('expense-note').fill('شاي وسكر');
    await page.getByTestId('expense-cat-مصروفات محل').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => sql(`select notes from expenses where number = '${f.prefix}-EXP-000001'`), {
        timeout: 60_000,
      })
      .toBe('شاي وسكر');
  });

  test('the manager writes a note with an expense and sees it in the list', async ({ page }) => {
    const f = newCashierFixture();
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.expenses }).click();
    await page.getByTestId('new-expense').click();
    await page.getByTestId('expense-note').fill('فاتورة كهرباء');
    await page.getByLabel(strings.cash.amount).fill('5');
    await page.getByTestId('save-money').click();
    await expect(page.getByTestId('save-money')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'فاتورة كهرباء' }).first()).toBeVisible();
    await expect
      .poll(() => sql(`select notes from expenses where number = '${f.prefix}-EXP-000001'`), {
        timeout: 60_000,
      })
      .toBe('فاتورة كهرباء');
  });
});
