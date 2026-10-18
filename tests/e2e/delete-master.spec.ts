import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { addWorker, loginAs, newFixture, sql, typeLogin } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

test.describe('delete customers, suppliers and workers', () => {
  test('a customer at balance 0 is deleted after the undo time; one with a balance is refused', async ({
    page,
  }) => {
    const f = newFixture();
    const free = randomUUID();
    const owing = randomUUID();
    const freeName = `عميل حذف ${free.slice(0, 6)}`;
    const owingName = `عميل عليه ${owing.slice(0, 6)}`;
    sql(
      `insert into customers (id, company_id, name) values ('${free}', '${COMPANY}', '${freeName}'), ('${owing}', '${COMPANY}', '${owingName}')`,
    );
    sql(
      `insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', 'customer', '${owing}', 5000, 'sales_invoice', '${randomUUID()}', now())`,
    );
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.customers }).click();

    await page.getByText(owingName).click();
    await page.getByTestId('delete-customer').click();
    await expect(page.getByText(strings.masterDelete.hasBalance)).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByText(freeName).click();
    await page.getByTestId('delete-customer').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(freeName)).toHaveCount(0);
    await expect
      .poll(() => sql(`select deleted_at is not null from customers where id = '${free}'`), {
        timeout: 60_000,
      })
      .toBe('t');
  });

  test('a supplier at balance 0 is deleted', async ({ page }) => {
    const f = newFixture();
    const id = randomUUID();
    const name = `مورد حذف ${id.slice(0, 6)}`;
    sql(`insert into suppliers (id, company_id, name) values ('${id}', '${COMPANY}', '${name}')`);
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.suppliers }).click();
    await page.getByText(name).click();
    await page.getByTestId('delete-supplier').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(name)).toHaveCount(0);
    await expect
      .poll(() => sql(`select deleted_at is not null from suppliers where id = '${id}'`), { timeout: 60_000 })
      .toBe('t');
  });

  test('a deleted worker disappears and can no longer log in', async ({ page, browser }) => {
    const f = newFixture();
    const w = addWorker('cashier');
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.workers }).click();
    await page.getByText(w.name).click();
    await page.getByTestId('delete-worker').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(w.name)).toHaveCount(0);
    await expect
      .poll(() => sql(`select deleted_at is not null from workers where username = '${w.user}'`), {
        timeout: 60_000,
      })
      .toBe('t');
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto('/');
    await expect(p2.getByTestId('setup-form')).toBeVisible();
    await typeLogin(p2, w);
    await expect(p2.getByText(strings.login.wrong)).toBeVisible({ timeout: 30_000 });
    await other.close();
  });
});
