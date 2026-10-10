import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift } from './helpers';

describe('manager approval', () => {
  test('a 10 percent line discount needs the manager PIN', async ({ app, screen, browser, agent }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await agent.act(
      'add {product} to the cart and give the first line a {pct} percent discount, stop when the manager PIN is asked',
      {
        params: { product: 'Test product 4', pct: '10' },
      },
    );
    for (const digit of f.pin) await browser.keyboard.press(digit);
    await browser.keyboard.press('Enter');
    await expect(screen.getByTestId('total')).toHaveText('18.00');
  });
});
