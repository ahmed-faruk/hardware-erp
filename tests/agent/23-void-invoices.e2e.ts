import { randomUUID } from 'node:crypto';

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, sql } from './helpers';

describe('delete a purchase invoice', () => {
  test('the manager deletes a purchase from the purchases screen and the invoice is voided on the server', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const company = 'a0000000-0000-7000-8000-000000000001';
    const run = randomUUID().slice(0, 6).toUpperCase();
    const sid = randomUUID();
    const inv = randomUUID();
    const number = `AG${run}-PUR-1`;
    sql(
      `insert into suppliers (id, company_id, name) values ('${sid}', '${company}', 'Agent supplier ${run}')`,
    );
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${company}', '${number}', now() - interval '2 days', '${sid}', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000)`,
    );
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.purchases).tap();
    await screen.getByTestId('f-number').fill(number);
    await screen.getByTestId(`delete-purchase-${number}`).tap();
    await screen.getByTestId('void-reason-mistake').tap();
    await expect
      .poll(() => sql(`select status from purchase_invoices where number = '${number}'`), { timeout: 60_000 })
      .toBe('voided');
  });
});
