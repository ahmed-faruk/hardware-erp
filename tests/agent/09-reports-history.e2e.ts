import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, piasters, sql } from './helpers';

describe('reports over imported history', () => {
  beforeAll(async () => {
    sql(
      `delete from sales_invoices where is_legacy and issued_at >= '2020-01-01' and issued_at < '2020-02-01' and number like 'AGENT-%'`,
    );
    for (const [i, total] of [100, 250, 400].entries()) {
      sql(`insert into sales_invoices (id, company_id, number, issued_at, status, is_legacy, subtotal, total, cash_tendered)
        select gen_random_uuid(), id, 'AGENT-LEG-${i + 1}', '2020-01-1${i + 1} 10:00+02', 'posted', true, ${piasters(total)}, ${piasters(total)}, ${piasters(total)} from companies limit 1`);
    }
  });
  test('the sales report for January 2020 equals the database', async ({ app, screen, browser, agent }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await agent.act('open Reports, the sales tab, and show the sales from {from} to {to}', {
      params: { from: '2020-01-01', to: '2020-01-31' },
    });
    const total = sql(
      `select coalesce(sum(total),0) from sales_invoices where issued_at >= '2020-01-01' and issued_at < '2020-02-01' and status = 'posted'`,
    );
    await expect(
      screen
        .getByTestId('report-totals-0')
        .getByText(String(Number(total) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ''), { exact: false }),
    ).toBeVisible();
  });
});
