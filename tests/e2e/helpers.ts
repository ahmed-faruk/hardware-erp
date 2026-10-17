import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

/** Test-only superuser query against the local database container (never used against staging or production). */
export function sql(query: string): string {
  const container = execFileSync('docker', ['ps', '-qf', 'name=supabase_db_hardware-erp'], {
    encoding: 'utf8',
  }).trim();
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-At', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export interface Creds {
  user: string;
  password: string;
}

export interface Fixture {
  /** the device registers itself on the first login: these are filled in by `loginAs` */
  deviceId: string;
  prefix: string;
  managerName: string;
  managerUser: string;
  managerPassword: string;
}

const PASSWORD = 'pass1234';

/** A worker with a login (username + bcrypt password hash made by the database), as the Workers screen would create it. */
function makeWorker(name: string, role: string): Creds {
  const user = `u${randomBytes(5).toString('hex')}`;
  const id = randomUUID();
  sql(
    `insert into workers (id, company_id, name, role, active, username) values (${q(id)}, ${q(COMPANY)}, ${q(name)}, ${q(role)}, true, ${q(user)})`,
  );
  sql(
    `insert into worker_credentials (worker_id, company_id, password_hash, must_change) values (${q(id)}, ${q(COMPANY)}, extensions.crypt(${q(PASSWORD)}, extensions.gen_salt('bf')), false)`,
  );
  return { user, password: PASSWORD };
}

/** A manager with a known login. The shop has one shift, so every test starts with none open. */
export function newFixture(): Fixture {
  sql("update shifts set status = 'closed', closed_at = now() where status = 'open'");
  const managerName = `مدير ${randomUUID().slice(0, 8)}`;
  const c = makeWorker(managerName, 'manager');
  return { deviceId: '', prefix: '', managerName, managerUser: c.user, managerPassword: c.password };
}

export const productId = (n: number): string =>
  `a0000000-0000-7000-8000-00000000${String(n).padStart(4, '0')}`;
const CATEGORY = 'a0000000-0000-7000-8000-0000000ca001';

export interface CashierFixture extends Fixture {
  cashierName: string;
  cashierUser: string;
  cashierPassword: string;
}

/**
 * A device with a drawer, a cashier with a PIN, one category holding products 1..8 (prices 12.50, 15.00, 17.50, 20.00, 22.50...),
 * barcodes 9000001..9000003 for products 1..3, and the default settings (no discount, no price change for the cashier).
 */
export function newCashierFixture(): CashierFixture {
  const f = newFixture();
  const cashierName = `كاشير ${randomUUID().slice(0, 8)}`;
  const cashier = makeWorker(cashierName, 'cashier');
  sql(
    `insert into categories (id, company_id, name, color_token, icon, sort) values (${q(CATEGORY)}, ${q(COMPANY)}, 'قسم الكاشير', 'cat-1', 'paint-roller', -1) on conflict (id) do nothing`,
  );
  sql(
    `update products set category_id = ${q(CATEGORY)}, active = true, deleted_at = null where id in (${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => q(productId(n))).join(',')})`,
  );
  for (const n of [1, 2, 3]) {
    sql(
      `insert into barcodes (id, company_id, product_id, code) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(productId(n))}, '900000${n}') on conflict do nothing`,
    );
  }
  sql(`delete from settings where company_id = ${q(COMPANY)} and key like 'sale.%'`);
  return { ...f, cashierName, cashierUser: cashier.user, cashierPassword: cashier.password };
}

/** Same as the default settings plus whatever the test changes (values are JSON). */
export function setSetting(key: string, value: string): void {
  sql(
    `insert into settings (id, company_id, key, value) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(key)}, ${q(value)}::jsonb) on conflict (company_id, key) do update set value = excluded.value`,
  );
}

/** A worker of the given role with a known login, on the company. */
export function addWorker(role: 'cashier' | 'storekeeper' | 'manager'): Creds & { name: string } {
  const name = `${role === 'storekeeper' ? 'أمين' : role === 'cashier' ? 'كاشير' : 'مدير'} ${randomUUID().slice(0, 8)}`;
  return { name, ...makeWorker(name, role) };
}

export type Who = 'manager' | 'cashier' | Creds;

const credsOf = (f: Fixture | CashierFixture, who: Who): Creds =>
  who === 'manager'
    ? { user: f.managerUser, password: f.managerPassword }
    : who === 'cashier'
      ? { user: (f as CashierFixture).cashierUser, password: (f as CashierFixture).cashierPassword }
      : who;

/** Types a login on the login form that is on screen and submits it. */
export async function typeLogin(page: Page, who: Creds): Promise<void> {
  await page.getByTestId('login-username').fill(who.user);
  await page.getByTestId('login-password').fill(who.password);
  await page.getByTestId('login-submit').click();
}

/**
 * First run on a fresh browser: the first login registers the browser as a device, the second one is the worker's own login
 * (the same form). Afterwards `f.deviceId` and `f.prefix` hold the device that was just registered.
 */
export async function loginAs(page: Page, f: Fixture | CashierFixture, who: Who = 'manager'): Promise<void> {
  const c = credsOf(f, who);
  await page.goto('/');
  await expect(page.getByTestId('setup-form')).toBeVisible();
  await typeLogin(page, c);
  await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 300_000 });
  await typeLogin(page, c);
  await expect(page.getByTestId('login-form')).toHaveCount(0, { timeout: 60_000 });
  const id = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok) => {
      const r = indexedDB.open('HanafyPOS');
      r.onsuccess = () => ok(r.result);
    });
    return await new Promise<{ deviceId: string; prefix: string }>((ok) => {
      const q = db.transaction('deviceSettings').objectStore('deviceSettings').get('device');
      q.onsuccess = () => ok(q.result.value);
    });
  });
  f.deviceId = id.deviceId;
  f.prefix = id.prefix;
}

/** Cash moved by the documents of one device (their numbers start with its prefix). */
export const deviceCash = (prefix: string): number =>
  Number(
    sql(
      `select coalesce(sum(m.amount), 0) from cash_movements m where m.doc_id in (select id from sales_invoices where number like '${prefix}-%' union all select id from sales_returns where number like '${prefix}-%' union all select id from voids where number like '${prefix}-%' union all select id from expenses where number like '${prefix}-%' union all select id from customer_receipts where number like '${prefix}-%' union all select id from cash_adjustments where number like '${prefix}-%')`,
    ),
  );
