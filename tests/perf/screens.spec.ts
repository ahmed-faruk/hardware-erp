import { writeFileSync, mkdirSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { newCashierFixture, productId } from '../e2e/helpers';

// Time every screen of the system on the seeded volume (npm run perf:seed first): `npm run perf:screens` -> perf-results/screens.json.
// Numbers are measured in the browser: from the route change (or tab click) until no skeleton is left on screen for 300 ms.

interface Row {
  screen: string;
  ms: number;
  requests: { what: string; ms: number; bytes: number }[];
  longTasks: number;
  longestTaskMs: number;
}
const rows: Row[] = [];

async function settle(page: Page, timeout = 90_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quiet?: number };
      const busy = document.querySelectorAll('[aria-busy="true"]').length;
      if (busy > 0) {
        w.__quiet = undefined;
        return false;
      }
      w.__quiet ??= performance.now();
      return performance.now() - w.__quiet > 300;
    },
    undefined,
    { timeout, polling: 50 },
  );
}

async function measure(page: Page, screen: string, action: () => Promise<void>): Promise<void> {
  const reqs: Row['requests'] = [];
  const onResponse = async (r: import('@playwright/test').Response): Promise<void> => {
    const url = r.url();
    if (!url.includes(':54321')) return;
    const t = r.request().timing();
    const body = await r.body().catch(() => Buffer.alloc(0));
    reqs.push({
      what:
        new URL(url).pathname.replace('/rest/v1/rpc/', 'rpc:') + (r.request().postData()?.slice(0, 60) ?? ''),
      ms: Math.round(t.responseEnd),
      bytes: body.length,
    });
  };
  page.on('response', onResponse);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __quiet?: number };
    w.__long = [];
    w.__quiet = undefined;
  });
  const t0 = Date.now();
  await action();
  await settle(page);
  const ms = Date.now() - t0 - 300;
  page.off('response', onResponse);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  rows.push({
    screen,
    ms,
    requests: reqs.sort((a, b) => b.ms - a.ms).slice(0, 4),
    longTasks: long.length,
    longestTaskMs: Math.round(Math.max(0, ...long)),
  });
  console.log(
    `${screen.padEnd(34)} ${String(ms).padStart(6)} ms  long tasks: ${long.length}  slowest request: ${reqs[0]?.ms ?? 0} ms`,
  );
}

const go = (page: Page, hash: string) => async () => {
  await page.evaluate((h) => (window.location.hash = `#/${h}`), hash);
};

test('every manager screen and report tab', async ({ page }) => {
  test.setTimeout(900_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({
      entryTypes: ['longtask'],
    });
  });
  const f = newCashierFixture();
  const t0 = Date.now();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click({ timeout: 300_000 });
  console.log(`activation + first pull: ${Date.now() - t0} ms`);
  rows.push({
    screen: 'activation + first pull',
    ms: Date.now() - t0,
    requests: [],
    longTasks: 0,
    longestTaskMs: 0,
  });
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await settle(page);

  for (const [name, hash] of [
    ['products', 'products'],
    ['product form', `products/${productId(2)}`],
    ['categories', 'categories'],
    ['purchases', 'purchases'],
    ['stock adjustment', 'stock'],
    ['expenses', 'expenses'],
    ['customers', 'customers'],
    ['suppliers', 'suppliers'],
    ['payroll', 'payroll'],
    ['workers', 'workers'],
    ['settings', 'settings'],
    ['sell (manager)', 'sell'],
  ] as const) {
    await measure(page, name, go(page, hash));
  }

  await measure(page, 'reports (default tab)', go(page, 'reports'));
  for (const tab of [
    'sales',
    'profit',
    'purchases',
    'expenses',
    'categories',
    'payroll',
    'exceptions',
    'devices',
    'stock',
    'smart',
    'productHistory',
  ]) {
    await measure(page, `reports / ${tab}`, async () => {
      await page.getByTestId(`report-tab-${tab}`).click();
    });
  }
  // a period of 400 days on the heavy tabs
  for (const tab of ['sales', 'profit', 'categories', 'expenses']) {
    await page.getByTestId(`report-tab-${tab}`).click();
    await settle(page);
    await measure(page, `reports / ${tab} / 400 days`, async () => {
      await page
        .getByTestId('report-from')
        .fill(new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10));
    });
  }
  mkdirSync('perf-results', { recursive: true });
  writeFileSync('perf-results/screens.json', JSON.stringify(rows, null, 2));
});

test('cashier: login to a paid sale', async ({ page }) => {
  test.setTimeout(300_000);
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click({ timeout: 300_000 });
  await page.keyboard.type(f.cashierPin);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  console.log(`cashier login -> sell screen: ${Date.now() - t0} ms`);
  for (const n of [1, 2, 3, 4, 5])
    await page
      .locator(`[data-testid="tile-${productId(n)}"] button`)
      .first()
      .click();
  const t1 = Date.now();
  await page.locator('[data-testid="pay"]:visible').first().click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('200');
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  console.log(`cashier pay -> done: ${Date.now() - t1} ms`);
});
