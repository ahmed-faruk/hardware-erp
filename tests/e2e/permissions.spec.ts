import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId } from './helpers';

test('a manager builds a permission group and gives it to a cashier: the screen follows it at once', async ({
  page,
}) => {
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  // the group: cashier defaults, no expenses, may give any discount without a manager's PIN
  await page.getByRole('button', { name: strings.nav.workers }).click();
  await page.getByTestId('workers-tab-groups').click();
  await page.getByTestId('new-group').click();
  await page.getByTestId('group-name').fill('كاشير بدون مصروفات');
  await page.getByTestId('group-copy').selectOption('role:cashier');
  await page.getByTestId('perm-recordExpense-no').click();
  await page.getByTestId('perm-discountOverLimit-yes').click();
  await page.getByTestId('save-group').click();
  await expect(page.getByText('كاشير بدون مصروفات')).toBeVisible();

  // give it to the cashier
  await page.getByTestId('workers-tab-workers').click();
  await page.getByText(f.cashierName).click();
  await page.getByTestId('worker-group').selectOption({ label: 'كاشير بدون مصروفات' });
  await page.getByTestId('save-worker').click();
  await expect(page.getByTestId('worker-group')).toHaveCount(0);

  // the cashier: a 10 percent discount goes through without anybody's PIN, and the expense tool is gone
  await page.getByTestId('lock').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await page
    .locator(`[data-testid="tile-${productId(1)}"] button`)
    .first()
    .click(); // 12.50
  await page.getByTestId('discount-0').click();
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="total"]:visible').first()).toHaveText('11.25');
  await page.getByTestId('shift-menu').click();
  await expect(page.getByTestId('shift-transfer')).toBeVisible();
  await expect(page.getByTestId('shift-expense')).toHaveCount(0);
});
