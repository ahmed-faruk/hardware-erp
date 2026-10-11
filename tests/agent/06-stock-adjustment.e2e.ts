import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, sql } from './helpers';
import { strings } from '../../src/ui/strings.ar';

describe('stock adjustment', () => {
  test('count Test product 6 with the count reason', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.stock).tap();
    await screen.getByTestId('product-picker').fill('Test product 6');
    await screen.getByTestId('product-picker').press('Enter');
    // the shared catalog keeps stock between runs: count three more than the system says
    const system = Number(
      ((await screen.getByText(`${strings.stock.system}:`, { exact: false }).textContent()) ?? '').replace(
        /[^\d.-]/g,
        '',
      ),
    );
    await screen.getByLabel(strings.stock.counted).fill(String(system + 3));
    await expect(screen.getByTestId('adjust-diff')).toContainText('3');
    await screen.getByTestId('save-adjustment').tap();
    await expect
      .poll(() => sql(`select reason_code from stock_adjustments where number = '${f.prefix}-ADJ-000001'`), {
        timeout: 60_000,
      })
      .toBe('count');
  });
});
