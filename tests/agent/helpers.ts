import type { Browser } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

import { newCashierFixture, productId, sql } from '../e2e/helpers';
import type { CashierFixture } from '../e2e/helpers';

export { newCashierFixture, productId, sql };
export type { CashierFixture };

export const CUSTOMER = 'a0000000-0000-7000-8000-000000000c01';
export const piasters = (pounds: number): string => String(Math.round(pounds * 100));

/** Every step here is an exact locator action: no model, no key, nothing to record. PINs are typed key by key. */
const typeKeys = async (browser: Browser, text: string): Promise<void> => {
  for (const key of text) await browser.keyboard.press(key);
};

const visible = (screen: Screen, id: string) => screen.getByTestId(id, { visible: true }).first();

export async function login(
  screen: Screen,
  browser: Browser,
  f: CashierFixture,
  who: 'cashier' | 'manager',
): Promise<void> {
  const user = who === 'cashier' ? f.cashierUser : f.managerUser;
  const password = who === 'cashier' ? f.cashierPassword : f.managerPassword;
  const type = async (): Promise<void> => {
    await screen.getByTestId('login-username').fill(user);
    await screen.getByTestId('login-password').fill(password);
    await screen.getByTestId('login-submit').tap();
  };
  // the first login registers this browser as a device; the second is the worker's own login (the same form)
  await expect(screen.getByTestId('setup-form')).toBeVisible();
  await type();
  await expect(screen.getByTestId('login-form')).toBeVisible();
  await type();
  // the device that was just registered
  const row = sql(`select id || ',' || prefix from devices order by created_at desc limit 1`).split(',');
  f.deviceId = row[0] ?? '';
  f.prefix = row[1] ?? '';
  void browser;
}

export async function openShift(screen: Screen, browser: Browser, float = '100'): Promise<void> {
  await screen.getByTestId('open-shift').tap();
  await typeKeys(browser, float);
  await browser.keyboard.press('Enter');
}

export const addProduct = (screen: Screen, n: number) =>
  screen
    .getByTestId(`tile-${productId(n)}`)
    .getByRole('button')
    .first()
    .tap();

export const goPay = (screen: Screen) => visible(screen, 'pay').tap();

export async function payCash(screen: Screen, browser: Browser, amount: string): Promise<void> {
  await goPay(screen);
  await screen.getByTestId('pay-cash').tap();
  await typeKeys(browser, amount);
  await browser.keyboard.press('Enter');
  await screen.getByTestId('finish').tap();
}

export async function payCreditToTestCustomer(screen: Screen): Promise<void> {
  await goPay(screen);
  await screen.getByTestId('pay-credit').tap();
  await screen.getByTestId(`customer-${CUSTOMER}`).tap();
  await screen.getByTestId('full-amount').tap();
  await screen.getByTestId('finish').tap();
}

export const visibleTotal = (screen: Screen) => visible(screen, 'total');
export { typeKeys };
