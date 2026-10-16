import { randomUUID } from 'node:crypto';

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, productId, sql } from './helpers';

describe('invoice search and the purchases report by supplier', () => {
  test('a manager narrows the sales invoices by payment method and finds an old invoice, then sees a supplier with its invoices', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 5).toUpperCase();
    const company = 'a0000000-0000-7000-8000-000000000001';
    const mk = (n: number, method: string, total: number) => {
      const id = randomUUID();
      const number = `AG${run}-INV-${900000 + n}`;
      sql(
        `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status) values ('${id}', '${company}', '${number}', now(), ${total}, ${total}, 'posted')`,
      );
      sql(
        `insert into payments (id, company_id, document_type, document_id, method, amount) values (gen_random_uuid(), '${company}', 'sales_invoice', '${id}', '${method}', ${total})`,
      );
      return number;
    };
    const cash = mk(1, 'cash', 1000);
    const card = mk(2, 'card', 2000);
    const supplier = `Agent supplier ${run}`;
    const sid = randomUUID();
    sql(`insert into suppliers (id, company_id, name) values ('${sid}', '${company}', '${supplier}')`);
    const inv = randomUUID();
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${company}', 'AG${run}-PUR-1', now(), '${sid}', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000)`,
    );
    sql(
      `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values (gen_random_uuid(), '${company}', '${inv}', 1, '${productId(7)}', 1000, 10000, 500, 5000)`,
    );
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.salesInvoices).tap();
    await screen.getByTestId('f-number').fill(`AG${run}`);
    await expect(screen.getByTestId(`view-${cash}`)).toBeVisible();
    await expect(screen.getByTestId(`view-${card}`)).toBeVisible();
    await screen.getByTestId('f-method').selectOption({ label: strings.receipt.pay.card });
    await expect(screen.getByTestId(`view-${card}`)).toBeVisible();
    await expect(screen.getByTestId(`view-${cash}`)).toBeHidden();
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-purchases').tap();
    await expect(screen.getByText(`${supplier} · ${strings.reports.invoices}: 1`)).toBeVisible();
  });
});
