import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, piasters, sql } from './helpers';
import { strings } from '../../src/ui/strings.ar';

describe('reports over imported history', () => {
  beforeAll(async () => {
    sql(`delete from sales_invoices where number like 'AGENT-LEG-%'`);
    for (const [i, total] of [100, 250, 400].entries()) {
      sql(`insert into sales_invoices (id, company_id, number, issued_at, status, is_legacy, subtotal, total, cash_tendered)
        select gen_random_uuid(), id, 'AGENT-LEG-${i + 1}', '2020-01-1${i + 1} 10:00+02', 'posted', true, ${piasters(total)}, ${piasters(total)}, ${piasters(total)} from companies limit 1`);
    }
  });
  test('the sales report for January 2020 equals the database', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-sales').tap();
    await screen.getByTestId('report-from').fill('2020-01-01');
    await screen.getByTestId('report-to').fill('2020-01-31');
    await expect(screen.getByTestId('report-table-0')).toBeVisible();
    const total =
      Number(
        sql(
          `select coalesce(sum(total), 0) from sales_invoices where issued_at >= '2020-01-01' and issued_at < '2020-02-01' and status = 'posted'`,
        ),
      ) / 100;
    await expect(screen.getByTestId('report-totals-0')).toContainText(total.toFixed(2));
  });
});
