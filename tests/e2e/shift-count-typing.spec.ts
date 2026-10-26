import { expect, test } from '@playwright/test';

import { formatMoney } from '../../src/domain/money';

import { loginAs, newCashierFixture, sql } from './helpers';

test('closing a shift: each note count can be typed (Western or Arabic digits) as well as tapped', async ({
  page,
}) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'cashier');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  await page.getByTestId('shift-menu').click();
  await page.getByTestId('shift-close').click();
  const count = (d: number) => page.getByTestId(`denom-${d}-count`);
  const soFar = page.getByTestId('counted-so-far');

  await count(5000).fill('3'); // 3 x 50.00
  await expect(soFar).toHaveText(formatMoney(15000));
  await count(1000).fill('٥'); // an Arabic digit: 5 x 10.00
  await expect(count(1000)).toHaveValue('5');
  await expect(soFar).toHaveText(formatMoney(20000));
  await count(500).fill('ab'); // letters are ignored
  await expect(count(500)).toHaveValue('');
  await count(25).fill('12345'); // more than 4 digits is ignored
  await expect(count(25)).toHaveValue('');
  await expect(soFar).toHaveText(formatMoney(20000));
  await page.getByTestId('denom-5000-plus').click(); // + goes on from the typed 3
  await expect(count(5000)).toHaveValue('4');
  await page.getByTestId('denom-5000-minus').click();
  await expect(count(5000)).toHaveValue('3');
  await count(1000).fill(''); // cleared = 0
  await expect(soFar).toHaveText(formatMoney(15000));
  await count(5000).fill('2'); // 100.00, exactly the opening float
  await expect(soFar).toHaveText(formatMoney(10000));

  await page.getByTestId('count-done').click();
  await expect(page.getByTestId('close-variance')).toHaveText(formatMoney(0));
  await page.getByTestId('close-confirm').click();
  await expect(page.getByTestId('open-shift')).toBeVisible();
  await expect
    .poll(
      () =>
        sql(`select counted_total || ':' || variance from shifts where number = '${f.prefix}-SHF-000001'`),
      { timeout: 60_000 },
    )
    .toBe('10000:0');
});
