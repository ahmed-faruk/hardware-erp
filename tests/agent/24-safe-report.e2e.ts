import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { formatMoney } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, sql } from './helpers';

describe('the safe report', () => {
  test('the manager opens «الخزنة» and the cash-now card equals every cash movement in the database', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-safe').tap();
    const now = Number(
      sql(
        `select coalesce(sum(m.amount), 0) from cash_movements m where m.company_id = 'a0000000-0000-7000-8000-000000000001'`,
      ),
    );
    await expect(screen.getByTestId('safe-cash-now')).toBeVisible();
    await expect(screen.getByTestId('safe-cash-now')).toContainText(formatMoney(now));
  });
});
