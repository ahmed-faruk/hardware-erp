import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture } from './helpers';

describe('the safe report', () => {
  test('the manager opens «الخزنة»: the net and today’s returns are there, the cash-now card is gone (owner decision 2026-11-01)', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-safe').tap();
    await expect(screen.getByTestId('safe-net')).toBeVisible();
    await expect(screen.getByTestId('safe-returns-card')).toBeVisible();
    await expect(screen.getByTestId('safe-cash-now-card')).toHaveCount(0);
  });
});
