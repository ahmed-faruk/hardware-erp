import { beforeAll, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, piasters, sql } from './helpers';
import { strings } from '../../src/ui/strings.ar';

describe('reports over imported history', () => {
  beforeAll(async () => {
    sql(`delete from legacy_sales where id between 800201 and 800203`);
    for (const [i, total] of [100, 250, 400].entries()) {
      sql(
        `insert into legacy_sales (company_id, id, kind, day, total, cash) select id, ${800201 + i}, 0, '2020-01-1${i + 1}', ${piasters(total)}, ${piasters(total)} from companies limit 1`,
      );
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
          `select coalesce(sum(case when kind = 0 then total else -total end), 0) from legacy_sales where day between '2020-01-01' and '2020-01-31'`,
        ),
      ) / 100;
    await expect(screen.getByTestId('report-totals-0')).toContainText(total.toFixed(2));
  });
});
