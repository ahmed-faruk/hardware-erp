import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newFixture, sql, typeLogin } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

/** A manager whose password must be changed at the first login (like the first admin/admin account). */
function newAdmin(): { user: string; password: string } {
  const user = `adm${randomBytes(4).toString('hex')}`;
  const id = randomUUID();
  sql(
    `insert into workers (id, company_id, name, role, active, username) values ('${id}', '${COMPANY}', 'admin ${user}', 'manager', true, '${user}')`,
  );
  sql(
    `insert into worker_credentials (worker_id, company_id, password_hash, must_change) values ('${id}', '${COMPANY}', extensions.crypt('admin', extensions.gen_salt('bf')), true)`,
  );
  return { user, password: 'admin' };
}

test.describe('login by username and password', () => {
  test('the first login must change the password; a second browser registers itself with it; offline login works after one online login', async ({
    page,
    browser,
    context,
  }) => {
    const admin = newAdmin();
    const next = 'newpass1';
    await page.goto('/');
    await typeLogin(page, admin); // registers this browser as a device
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 300_000 });
    await typeLogin(page, admin); // the worker's own login: the password has to change first
    await expect(page.getByTestId('new-password')).toBeVisible();
    await page.getByTestId('new-password').fill('abc');
    await page.getByTestId('new-password2').fill('abc');
    await page.getByTestId('change-password').click();
    await expect(page.getByText(strings.login.short)).toBeVisible();
    await page.getByTestId('new-password').fill(next);
    await page.getByTestId('new-password2').fill('different');
    await page.getByTestId('change-password').click();
    await expect(page.getByText(strings.login.mismatch)).toBeVisible();
    await page.getByTestId('new-password2').fill(next);
    await page.getByTestId('change-password').click();
    await expect(page.getByTestId('sync-status')).toBeVisible();
    expect(
      sql(
        `select must_change from worker_credentials c join workers w on w.id = c.worker_id where w.username = '${admin.user}'`,
      ),
    ).toBe('f');

    // a second browser: no code, just the new password; it gets its own device prefix
    const f2 = newFixture();
    const page2 = await (await browser.newContext()).newPage();
    await loginAs(page2, f2, { user: admin.user, password: next });
    expect(f2.prefix).not.toBe('');
    expect(sql(`select count(*) from devices where prefix = '${f2.prefix}' and max_role = 'manager'`)).toBe(
      '1',
    );

    // lock, go offline: the same login works from the saved verifier, a wrong password does not
    await page.getByTestId('lock').click();
    await context.setOffline(true);
    await typeLogin(page, { user: admin.user, password: 'wrong-password' });
    await expect(page.getByText(strings.login.wrong)).toBeVisible({ timeout: 45_000 });
    await typeLogin(page, { user: admin.user, password: next });
    await expect(page.getByTestId('sync-status')).toBeVisible({ timeout: 45_000 });
    await context.setOffline(false);
  });

  test('a username nobody has is refused on the first run', async ({ page }) => {
    await page.goto('/');
    await typeLogin(page, { user: 'nobody-here', password: 'whatever1' });
    await expect(page.getByText(strings.login.wrong)).toBeVisible();
  });
});
