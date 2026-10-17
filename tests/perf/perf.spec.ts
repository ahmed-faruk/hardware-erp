import { expect, test, type Page } from '@playwright/test';

import { loginAs, newCashierFixture, productId, sql, type CashierFixture } from '../e2e/helpers';

// docs: skill testing-playbook §6. Chromium with the CPU slowed 4x (a shop PC / old phone), numbers measured in the browser.
const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] as number;

async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function login(page: Page, f: CashierFixture): Promise<void> {
  await loginAs(page, f, 'cashier');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

test.describe('performance (4x slower CPU)', () => {
  test('search over 20,000 products: p95 <= 300 ms, then a sale is saved in <= 1 s', async ({ page }) => {
    test.setTimeout(600_000);
    sql(
      `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals, active)
       select gen_random_uuid(), '${COMPANY}', 'PERF' || g, 'بيرف ' || g || ' صنف ' || (g % 97), 'pcs', 1000 + g % 5000, 500, 0, true from generate_series(1, 20000) g`,
    );
    try {
      const f = newCashierFixture();
      // the first pull of the catalog runs at full speed; the slow CPU is applied to what the cashier does after it
      const t0pull = Date.now();
      await login(page, f);
      console.log(`first login incl. pulling 20,000 products: ${Date.now() - t0pull} ms`);
      await throttle(page);
      // wait until the device has pulled the whole catalog (the sync counter shows 0 pending and the last product is searchable)
      await expect(page.getByTestId('sell-search')).toBeVisible();
      const search = page.getByTestId('sell-search');
      await expect
        .poll(
          async () => {
            await search.fill('بيرف 20000');
            return page.getByText('بيرف 20000 صنف').count();
          },
          { timeout: 300_000, intervals: [2000] },
        )
        .toBeGreaterThan(0);

      const times: number[] = [];
      for (let i = 0; i < 25; i++) {
        const n = 100 + ((i * 7919) % 19000);
        await search.fill('');
        const t0 = Date.now();
        await search.fill(`بيرف ${n}`);
        await expect(page.getByText(`بيرف ${n} صنف`).first()).toBeVisible({ timeout: 5000 });
        times.push(Date.now() - t0);
      }
      console.log(`search p95 ${p95(times)} ms over ${times.length} queries (max ${Math.max(...times)})`);
      expect(p95(times)).toBeLessThanOrEqual(300);

      await search.fill('');
      await page
        .locator(`[data-testid="tile-${productId(2)}"] button`)
        .first()
        .click();
      await page.locator('[data-testid="pay"]:visible').first().click();
      await page.getByTestId('pay-cash').click();
      await page.keyboard.type('20');
      await page.keyboard.press('Enter');
      const t0 = Date.now();
      await page.getByTestId('finish').click();
      await expect(page.getByTestId('done')).toBeVisible();
      const saveMs = Date.now() - t0;
      console.log(`sale saved in ${saveMs} ms`);
      expect(saveMs).toBeLessThanOrEqual(1000);
    } finally {
      sql(`delete from products where company_id = '${COMPANY}' and sku like 'PERF%'`);
    }
  });

  test('cold start offline: reload with the router unplugged shows the screen in <= 5 s', async ({
    page,
    context,
  }) => {
    const f = newCashierFixture();
    await throttle(page);
    await login(page, f);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    const t0 = Date.now();
    await page.reload();
    await expect(
      page.getByTestId('sell-search').or(page.getByRole('button', { name: new RegExp(f.cashierName) })),
    ).toBeVisible({ timeout: 10_000 });
    const ms = Date.now() - t0;
    console.log(`offline cold start ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(5000);
  });
});
