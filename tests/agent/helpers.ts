import type { Browser } from '@e2e-dev/web';
import type { Screen } from 'e2e';

import { newCashierFixture, productId, sql } from '../e2e/helpers';
import type { CashierFixture } from '../e2e/helpers';

export { newCashierFixture, productId, sql };
export type { CashierFixture };

/** Activation, worker choice and PIN are fixed locator steps: a PIN never goes to the agent. */
export async function login(
  screen: Screen,
  browser: Browser,
  f: CashierFixture,
  who: 'cashier' | 'manager',
): Promise<void> {
  await screen.getByTestId('activation-code').fill(f.code);
  await screen.getByTestId('activate').tap();
  await screen.getByText(who === 'cashier' ? f.cashierName : f.managerName, { exact: false }).tap();
  for (const digit of who === 'cashier' ? f.cashierPin : f.pin) await browser.keyboard.press(digit);
  await browser.keyboard.press('Enter');
}

export async function openShift(screen: Screen, browser: Browser, float = '100'): Promise<void> {
  await screen.getByTestId('open-shift').tap();
  for (const digit of float) await browser.keyboard.press(digit);
  await browser.keyboard.press('Enter');
}

/** The id numbers come from a plain number-to-string conversion, so tests can compare money in piasters. */
export const piasters = (pounds: number): string => String(Math.round(pounds * 100));
