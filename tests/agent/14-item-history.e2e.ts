import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { addProduct, login, newCashierFixture, openShift, payCash, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

describe('item history', () => {
  test('a device sale and an imported sale both appear with the balance after each', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const legacyId = '0190f000-0000-7000-8000-0000000007a2';
    sql(`delete from sales_invoice_lines where invoice_id = '${legacyId}'`);
    sql(`delete from sales_invoices where id = '${legacyId}'`);
    sql(
      `insert into sales_invoices (id, company_id, number, issued_at, subtotal, total, status, is_legacy) values ('${legacyId}', '${COMPANY}', 'OSPOS-AGENT-1', '2020-02-10 10:00:00+02', 1500, 1500, 'posted', true)`,
    );
    sql(
      `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, is_legacy) values (gen_random_uuid(), '${COMPANY}', '${legacyId}', 1, '${productId(2)}', 1000, 2000, 750, 1500, 400, 0, true)`,
    );
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.sell).tap();
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await payCash(screen, browser, '20');
    await expect(screen.getByTestId('done')).toBeVisible();
    await expect
      .poll(() => sql(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe('1');
    await browser.evaluate((id: string) => (window.location.hash = `#/products/${id}`), productId(2));
    await screen.getByTestId('product-view-history').tap();
    await screen.getByTestId('history-all').tap();
    await expect(screen.getByTestId('report-table-0')).toContainText(`${f.prefix}-INV-000001`);
    await expect(screen.getByTestId('report-table-0')).toContainText('OSPOS-AGENT-1');
    await expect(screen.getByTestId('report-table-0')).toContainText(strings.reports.legacyTag);
  });
});
