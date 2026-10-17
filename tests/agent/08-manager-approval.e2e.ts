import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { addProduct, login, newCashierFixture, openShift, typeKeys, visibleTotal } from './helpers';

describe('no approvals', () => {
  test('a 10 percent line discount is refused to a cashier: nothing asks for a manager', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 1); // 12.50
    await screen.getByTestId('discount-0').tap();
    await typeKeys(browser, '10');
    await browser.keyboard.press('Enter');
    await expect(screen.getByText(strings.forbidden)).toBeVisible();
    await expect(visibleTotal(screen)).toHaveText('12.50');
  });
});
