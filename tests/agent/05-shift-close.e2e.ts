import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, sql } from './helpers';

describe('shift close', () => {
  test('close the shift counting exactly the float: variance 0.00', async ({
    app,
    screen,
    browser,
    agent,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser, '110');
    await agent.act('close the shift and count one 100 note and one 10 note', {});
    await expect
      .poll(
        () => sql(`select status || ':' || variance from shifts where number = '${f.prefix}-SHF-000001'`),
        { timeout: 60_000 },
      )
      .toBe('closed:0');
  });
});
