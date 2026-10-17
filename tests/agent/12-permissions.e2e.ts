import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { addProduct, login, newCashierFixture, openShift, typeKeys } from './helpers';

describe('permission groups', () => {
  test('a group without expenses and with free discounts changes what the cashier sees', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.workers).tap();
    await screen.getByTestId('workers-tab-groups').tap();
    await screen.getByTestId('new-group').tap();
    await screen.getByTestId('group-name').fill('Agent group');
    await screen.getByTestId('group-copy').selectOption({ value: 'role:cashier' });
    await screen.getByTestId('perm-recordExpense-no').tap();
    await screen.getByTestId('perm-discountOverLimit-yes').tap();
    await screen.getByTestId('save-group').tap();
    await expect(screen.getByTestId('save-group')).toHaveCount(0);
    await screen.getByTestId('workers-tab-workers').tap();
    await screen.getByText(f.cashierName).tap();
    await screen.getByTestId('worker-group').selectOption({ label: 'Agent group' });
    await screen.getByTestId('save-worker').tap();
    await expect(screen.getByTestId('save-worker')).toHaveCount(0);

    await screen.getByTestId('lock').tap();
    await screen.getByTestId('login-username').fill(f.cashierUser);
    await screen.getByTestId('login-password').fill(f.cashierPassword);
    await screen.getByTestId('login-submit').tap();
    await openShift(screen, browser);
    await addProduct(screen, 1); // 12.50
    await screen.getByTestId('discount-0').tap();
    await typeKeys(browser, '10');
    await browser.keyboard.press('Enter');
    await expect(screen.getByTestId('total', { visible: true }).first()).toHaveText('11.25');
    await screen.getByTestId('shift-menu').tap();
    await expect(screen.getByTestId('shift-x')).toBeVisible();
    await expect(screen.getByTestId('shift-expense')).toHaveCount(0);
  });
});
