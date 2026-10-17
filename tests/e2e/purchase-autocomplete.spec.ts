import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, type CashierFixture, loginAs } from './helpers';

async function openNew(page: Page, f: CashierFixture): Promise<void> {
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await expect(page.getByTestId('purchase-scan')).toBeVisible();
}

const box = (page: Page) => page.getByTestId('purchase-scan');

test.describe('product box on the purchase screen: autocomplete', () => {
  test('typing part of a name lists products; arrow + Enter adds one; the box is empty and focused again', async ({
    page,
  }) => {
    await openNew(page, newCashierFixture());
    await box(page).fill('Test product 6');
    await expect(page.getByTestId('purchase-scan-option-0')).toContainText('Test product 6');
    await box(page).press('ArrowDown');
    await box(page).press('Enter');
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.locator('[data-testid="purchase-line"]').first()).toContainText('Test product 6');
    await expect(box(page)).toHaveValue('');
    await expect(box(page)).toBeFocused();
  });

  test('a click on a suggestion adds it; picking the same product again makes quantity 2 on one line', async ({
    page,
  }) => {
    await openNew(page, newCashierFixture());
    for (let i = 0; i < 2; i++) {
      await box(page).fill('Test product 5');
      await page.getByTestId('purchase-scan-option-0').click();
    }
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('2');
  });

  test('several words and a short text: no list under two characters', async ({ page }) => {
    await openNew(page, newCashierFixture());
    await box(page).fill('T');
    await expect(page.getByTestId('purchase-scan-list')).toHaveCount(0);
    await box(page).fill('test 4');
    await expect(page.getByTestId('purchase-scan-option-0')).toContainText('Test product 4');
  });

  test('a barcode still adds directly, and an unknown 13-digit code still opens quick-add', async ({
    page,
  }) => {
    await openNew(page, newCashierFixture());
    await box(page).fill('9000002');
    await box(page).press('Enter');
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.locator('[data-testid="purchase-line"]').first()).toContainText('Test product 2');
    await box(page).fill('9876543210123');
    await box(page).press('Enter');
    await expect(page.getByTestId('qa-name')).toBeVisible();
  });

  test('Enter with a name and no suggestion chosen yet still finds the product (the box fits 320 to 1366 px)', async ({
    page,
  }) => {
    await openNew(page, newCashierFixture());
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [1024, 768],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await box(page).fill('Test product 7');
      await expect(page.getByTestId('purchase-scan-option-0')).toBeVisible();
      const found = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        height: document.querySelector<HTMLElement>('[data-testid="purchase-scan"]')!.getBoundingClientRect()
          .height,
      }));
      expect(found.page, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.height, `${width}px box height`).toBeGreaterThanOrEqual(43.5);
      await box(page).fill('');
    }
    await box(page).fill('Test product 7');
    await box(page).press('Enter');
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
  });
});
