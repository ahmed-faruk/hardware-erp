import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, sql } from './helpers';

describe('shift close', () => {
  test('close the shift counting exactly the float: variance 0.00', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser, '110');
    await screen.getByTestId('shift-menu').tap();
    await screen.getByTestId('shift-close').tap();
    await expect(screen.getByTestId('close-expected')).toHaveCount(0); // the count is blind
    await screen.getByTestId('denom-10000-plus').tap(); // 100.00
    await screen.getByTestId('denom-1000-plus').tap(); // 10.00
    await expect(screen.getByTestId('counted-so-far')).toHaveText('110.00');
    await screen.getByTestId('count-done').tap();
    await expect(screen.getByTestId('close-variance')).toHaveText('0.00');
    await screen.getByTestId('close-confirm').tap();
    await expect(screen.getByTestId('open-shift')).toBeVisible();
    await expect
      .poll(
        () => sql(`select status || ':' || variance from shifts where number = '${f.prefix}-SHF-000001'`),
        { timeout: 60_000 },
      )
      .toBe('closed:0');
  });
});
