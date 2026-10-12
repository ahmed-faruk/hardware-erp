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
    sql(`update products set legacy_item_id = 880002 where id = '${productId(2)}'`);
    sql(`delete from legacy_sale_lines where sale_id = 800102`);
    sql(`delete from legacy_sales where id = 800102`);
    sql(
      `insert into legacy_sales (company_id, id, kind, day, total, cash) values ('${COMPANY}', 800102, 0, '2020-02-10', 1500, 1500)`,
    );
    sql(
      `insert into legacy_sale_lines (sale_id, line_no, product_id, qty, net, cost) values (800102, 1, 880002, 2000, 1500, 800)`,
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
    await expect(screen.getByTestId('report-table-0')).toContainText('LG-INV-800102');
    await expect(screen.getByTestId('report-table-0')).toContainText(strings.reports.legacyTag);
  });
});
