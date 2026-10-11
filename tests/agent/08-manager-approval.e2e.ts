import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, typeKeys, visibleTotal } from './helpers';

describe('manager approval', () => {
  test('a 10 percent line discount needs the manager PIN', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 1); // 12.50
    await screen.getByTestId('discount-0').tap();
    await typeKeys(browser, '10');
    await browser.keyboard.press('Enter');
    await screen.getByText(f.managerName, { exact: false }).tap();
    await typeKeys(browser, f.pin);
    await browser.keyboard.press('Enter');
    await expect(visibleTotal(screen)).toHaveText('11.25');
  });
});
