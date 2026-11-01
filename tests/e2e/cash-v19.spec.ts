import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, productId, sql, typeLogin } from './helpers';

const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

test.describe('v19: money in and out of the box, return approval', () => {
  test('a transfer goes from outside the box into it and back; the same place on both sides cannot be saved', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.expenses }).click();

    await page.getByTestId('new-transfer').click();
    await expect(page.getByTestId('money-from').locator('option')).toHaveText([
      strings.cash.insideSafe,
      strings.cash.outsideSafe,
    ]);
    await expect(page.getByTestId('money-from').locator('option:checked')).toHaveText(
      strings.cash.outsideSafe,
    );
    await expect(page.getByTestId('money-to').locator('option:checked')).toHaveText(strings.cash.insideSafe);
    await page.getByLabel(strings.cash.amount).fill('50');
    await page.getByTestId('save-money').click();
    await expect(page.getByTestId('save-money')).toHaveCount(0);
    const kinds = (n: string) =>
      sql(
        `select fa.kind || ':' || ta.kind || ':' || t.amount from cash_transfers t join cash_accounts fa on fa.id = t.from_account_id join cash_accounts ta on ta.id = t.to_account_id where t.number = '${f.prefix}-XFR-${n}'`,
      );
    await expect.poll(() => kinds('000001'), { timeout: 60_000 }).toBe('outside:safe:5000');

    await page.getByTestId('new-transfer').click();
    await page.getByTestId('money-from').selectOption({ label: strings.cash.insideSafe });
    await page.getByTestId('money-to').selectOption({ label: strings.cash.outsideSafe });
    await page.getByLabel(strings.cash.amount).fill('20');
    await page.getByTestId('save-money').click();
    await expect(page.getByTestId('save-money')).toHaveCount(0);
    await expect.poll(() => kinds('000002'), { timeout: 60_000 }).toBe('safe:outside:2000');

    await page.getByTestId('new-transfer').click();
    await page.getByTestId('money-to').selectOption({ label: strings.cash.outsideSafe });
    await page.getByLabel(strings.cash.amount).fill('5');
    await expect(page.getByTestId('save-money')).toBeDisabled();
  });

  test('a cashier return bigger than the box needs the manager login; a wrong login or a cashier login is refused', async ({
    page,
  }) => {
    const f = newCashierFixture();
    // the manager logs in first on this device (so the device can check the manager's login later), opens the shift and sells
    await loginAs(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sell-search')).toBeVisible();
    await page
      .locator(`[data-testid="tile-${productId(2)}"] button`)
      .first()
      .click(); // 15.00
    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await page.getByTestId('new-sale').click();
    // the box is counted 110.00 short: 100 + 15 - 110 = 5.00 left, less than the 15.00 refund
    await page.getByRole('button', { name: strings.nav.expenses }).click();
    await page.getByTestId('new-adjustment').click();
    await page.getByTestId('adjust-direction').selectOption('minus');
    await page.getByTestId('adjust-cash-reason').selectOption('count_error');
    await page.getByLabel(strings.cash.amount).fill('110');
    await page.getByTestId('save-money').click();
    await expect(page.getByTestId('save-money')).toHaveCount(0);

    // the cashier logs in on the same device and returns the item
    await page.reload();
    await typeLogin(page, { user: f.cashierUser, password: f.cashierPassword });
    await expect(page.getByTestId('sell-search')).toBeVisible();
    await page.getByTestId('return').click();
    await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
    await page.getByTestId('plus-1').click();
    await expect(page.getByTestId('refund-total')).toHaveText('15.00');
    await page.getByTestId('confirm-return').click();
    await expect(page.getByTestId('approve-username')).toBeVisible();

    // a wrong password, then the cashier's own login: refused
    await page.getByTestId('approve-username').fill(f.managerUser);
    await page.getByTestId('approve-password').fill('wrong-password-1');
    await page.getByTestId('approve-confirm').click();
    await expect(page.getByText(strings.approval.wrong)).toBeVisible();
    await page.getByTestId('approve-username').fill(f.cashierUser);
    await page.getByTestId('approve-password').fill(f.cashierPassword);
    await page.getByTestId('approve-confirm').click();
    await expect(page.getByText(strings.approval.wrong)).toBeVisible();

    // the manager approves: the return is made and the server keeps who approved it
    await page.getByTestId('approve-username').fill(f.managerUser);
    await page.getByTestId('approve-password').fill(f.managerPassword);
    await page.getByTestId('approve-confirm').click();
    await expect(page.getByTestId('print-offer')).toBeVisible();
    await expect
      .poll(
        () =>
          sql(
            `select w.username from sales_returns r join workers w on w.id = r.approved_by where r.number = '${f.prefix}-RET-000001'`,
          ),
        { timeout: 60_000 },
      )
      .toBe(f.managerUser);
  });
});
