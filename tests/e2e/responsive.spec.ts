import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newFixture, type Fixture } from './helpers';

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
] as const;
const SCREENS = [
  { hash: 'products', title: strings.products.title },
  { hash: 'products/new', title: strings.products.newProduct },
  { hash: 'categories', title: strings.categories.title },
  { hash: 'customers', title: strings.customers.title },
  { hash: 'suppliers', title: strings.suppliers.title },
  { hash: 'workers', title: strings.workers.title },
  { hash: 'purchases', title: strings.purchases.title },
  { hash: 'stock', title: strings.stock.title },
  { hash: 'expenses', title: strings.cash.expenses },
  { hash: 'reports', title: strings.reports.title },
  { hash: 'settings', title: strings.settings.title },
];

async function activateAndLogin(page: Page, f: Fixture): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

test('responsive: no horizontal scroll, tap targets >= 44 px, side rail from 900 px, bottom tabs below', async ({
  page,
}, info) => {
  const f = newFixture();
  await page.setViewportSize({ width: 1366, height: 768 });
  await activateAndLogin(page, f);
  const problems: string[] = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const screen of SCREENS) {
      await page.evaluate((h) => (window.location.hash = `#/${h}`), screen.hash);
      await expect(page.getByRole('heading', { name: screen.title })).toBeVisible();
      const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (scrolls) {
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('body *')]
            .filter(
              (el) =>
                el.getBoundingClientRect().right > window.innerWidth + 1 ||
                el.getBoundingClientRect().left < -1,
            )
            .slice(0, 4)
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}`,
            ),
        );
        problems.push(`${width}px ${screen.hash}: horizontal scroll (${wide.join(' | ')})`);
      }
      const small = await page.evaluate(() => {
        const tooSmall: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'button, select, input:not([type=checkbox]):not([type=hidden]), summary',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 43.5 || r.width < 43.5)
            tooSmall.push(
              `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
        }
        return tooSmall;
      });
      for (const s of small) problems.push(`${width}px ${screen.hash}: ${s}`);
      const nav = await page.locator('nav').boundingBox();
      const side = width >= 900;
      if (nav && side && nav.height < 200) problems.push(`${width}px: expected a side rail`);
      if (nav && !side && nav.width < width * 0.9) problems.push(`${width}px: expected bottom tabs`);
      await page.screenshot({
        path: info.outputPath(`${screen.hash.replace('/', '-')}-${width}x${height}.png`),
      });
    }
  }
  expect(problems).toEqual([]);
});
