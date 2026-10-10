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
