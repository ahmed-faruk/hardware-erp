import { expect, test, type Page } from '@playwright/test';

import { newCashierFixture, productId } from './helpers';

const VIEWPORTS = [
  [320, 568],
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 1024],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [844, 390], // a phone turned sideways (RSP-08)
] as const;

/** Looks for horizontal scroll and tap targets under 56 px (UX-11) inside the sale screen. */
async function check(page: Page, label: string): Promise<string[]> {
  return page.evaluate((where) => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push(`${where}: horizontal scroll`);
    for (const el of document.querySelectorAll<HTMLElement>(
      'main button, main input:not([type=checkbox]):not([type=hidden])',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 55.5 || r.width < 43.5)
        problems.push(
          `${where}: ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
    }
    return problems;
  }, label);
}

test('the sale and pay screens at every width: no horizontal scroll, tap targets of 56 px', async ({
  page,
}, info) => {
  const f = newCashierFixture();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  for (const n of [1, 2])
    await page
      .locator(`[data-testid="tile-${productId(n)}"] button`)
      .first()
      .click();

  const problems: string[] = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('sell-search')).toBeVisible();
    problems.push(...(await check(page, `${width}x${height} sell`)));
    await page.screenshot({ path: info.outputPath(`sell-${width}x${height}.png`) });
  }
  // zoom to 200%: the layout must still fit (RSP-08), simulated with a half-size viewport
  await page.setViewportSize({ width: 683, height: 384 });
  problems.push(...(await check(page, '200% zoom sell')));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('[data-testid="pay"]:visible').first().click();
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('pay-cash')).toBeVisible();
    problems.push(...(await check(page, `${width}x${height} pay`)));
    await page.screenshot({ path: info.outputPath(`pay-${width}x${height}.png`) });
  }
  expect(problems).toEqual([]);
});

test('return and collection dialogs fit every width with 56 px targets', async ({ page }, info) => {
  const f = newCashierFixture();
  // the sale prints its receipt: swallow print() so Firefox does not open a real print dialog
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click();
  await page.locator('[data-testid="pay"]:visible').first().click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await page.getByTestId('new-sale').click();

  const problems: string[] = [];
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1024, 768],
    [1366, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByTestId('return').click();
    await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
    await page.getByTestId('plus-1').click();
    problems.push(...(await check(page, `${width}x${height} return`)));
    await page.screenshot({ path: info.outputPath(`return-${width}x${height}.png`) });
    await page.locator('dialog[open] > header button').last().click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByTestId('collect').click();
    await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
    problems.push(...(await check(page, `${width}x${height} collect`)));
    await page.screenshot({ path: info.outputPath(`collect-${width}x${height}.png`) });
    await page.locator('dialog[open] > header button').last().click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test('shift menu and the counting screen fit every width with 56 px targets', async ({ page }, info) => {
  const f = newCashierFixture();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();

  const problems: string[] = [];
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1024, 768],
    [1366, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByTestId('shift-menu').click();
    problems.push(...(await check(page, `${width}x${height} shift menu`)));
    await page.getByTestId('shift-close').click();
    await page.getByTestId('denom-10000-plus').click();
    problems.push(...(await check(page, `${width}x${height} count`)));
    await page.screenshot({ path: info.outputPath(`count-${width}x${height}.png`) });
    await page.locator('dialog[open] > header button').last().click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});
