import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { addProduct, login, newCashierFixture, openShift, payCash, sql } from './helpers';

describe('returns report', () => {
  test('the sales returns tab equals the database for today', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.sell).tap();
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await payCash(screen, browser, '20');
    await expect(screen.getByTestId('done')).toBeVisible();
    await screen.getByTestId('new-sale').tap();
    await screen.getByTestId('return').tap();
    await screen.getByTestId(`return-${f.prefix}-INV-000001`).tap();
    await screen.getByTestId('plus-1').tap();
    await screen.getByTestId('confirm-return').tap();
    await expect
      .poll(() => sql(`select count(*) from sales_returns where number = '${f.prefix}-RET-000001'`), {
        timeout: 60_000,
      })
      .toBe('1');
    const total =
      Number(
        sql(
          `select coalesce(sum(total), 0) from sales_returns where status = 'posted' and is_legacy = false and (issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date`,
        ),
      ) / 100;
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-returns').tap();
    await screen.getByTestId('period-today').tap();
    await expect(screen.getByTestId('report-table-0')).toContainText(total.toFixed(2));
    await expect(screen.getByTestId('report-table-5')).toContainText(`${f.prefix}-RET-000001`);
  });
});
