import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, payCash } from './helpers';

describe('invoice view on screen', () => {
  test('a sale opens from the recent list with its lines and total', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await addProduct(screen, 3);
    await payCash(screen, browser, '50');
    await expect(screen.getByTestId('done')).toBeVisible();
    await screen.getByTestId('new-sale').tap();
    await screen.getByTestId('recent').tap();
    await screen.getByTestId(`view-${f.prefix}-INV-000001`).tap();
    await expect(screen.getByTestId('iv-total')).toHaveText('32.50');
    await expect(screen.getByTestId('invoice-view')).toContainText('Test product 2');
    await expect(screen.getByTestId('invoice-view')).toContainText('Test product 3');
  });
});
