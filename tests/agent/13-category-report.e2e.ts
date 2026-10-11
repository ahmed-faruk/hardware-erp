import { afterEach, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const FIRST = 'a0000000-0000-7000-8000-0000000ca001';
const SECOND = 'a0000000-0000-7000-8000-0000000ca002';

describe('sales by category', () => {
  // the test database is shared: put the catalog back for the other flows
  afterEach(async () => {
    sql(`update products set category_id = '${FIRST}' where id = '${productId(3)}'`);
    sql(`update products set category_id = null where category_id = '${SECOND}'`);
    sql(`delete from categories where id = '${SECOND}'`);
  });

  test('two categories sold on one invoice show in the charts, the KPIs and the table', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    sql(
      `insert into categories (id, company_id, name, color_token, icon, sort) values ('${SECOND}', '${COMPANY}', 'Agent plumbing', 'cat-2', 'wrench', -2) on conflict (id) do nothing`,
    );
    sql(`update products set category_id = '${SECOND}' where id = '${productId(3)}'`);
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.sell).tap();
    await screen.getByTestId('open-shift').tap();
    for (const digit of '100') await browser.keyboard.press(digit);
    await browser.keyboard.press('Enter');
    await screen.getByRole('button', 'قسم الكاشير').tap();
    await screen
      .getByTestId(`tile-${productId(2)}`)
      .getByRole('button')
      .first()
      .tap();
    await screen.getByRole('button', 'Agent plumbing').tap();
    await screen
      .getByTestId(`tile-${productId(3)}`)
      .getByRole('button')
      .first()
      .tap();
    await screen.getByTestId('pay', { visible: true }).first().tap();
    await screen.getByTestId('pay-cash').tap();
    for (const digit of '40') await browser.keyboard.press(digit);
    await browser.keyboard.press('Enter');
    await screen.getByTestId('finish').tap();
    await expect(screen.getByTestId('done')).toBeVisible();
    await expect
      .poll(() => sql(`select total from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe('3250');

    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-categories').tap();
    await screen.getByTestId('period-today').tap();
    await expect(screen.getByTestId('chart-bars')).toBeVisible();
    await expect(screen.getByTestId(`bar-${SECOND}`)).toBeVisible();
    await expect(screen.getByTestId('chart-days')).toBeVisible();
    await expect(screen.getByTestId('kpi-active')).toContainText('2');
    const revenue = (
      Number(
        sql(
          `select coalesce(sum(l.net_amount - l.alloc_discount), 0) from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id join products p on p.id = l.product_id where i.status = 'posted' and (i.issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date and p.category_id = '${SECOND}'`,
        ),
      ) / 100
    ).toFixed(2);
    await expect(screen.getByTestId('report-table-0')).toContainText(revenue);
  });
});
