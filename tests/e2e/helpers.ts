import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

// @ts-expect-error plain JS module shared with the Mac admin tools
import { hashPin } from '../../tools/device-admin/pin.mjs';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export interface Fixture {
  deviceId: string;
  code: string;
  pin: string;
  managerName: string;
  prefix: string;
}

/** A fresh device activation code and a manager with a known PIN, as `npm run device:add` and `worker:add` would create. */
export function newFixture(): Fixture {
  const code = Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const prefix = Array.from(randomBytes(3), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const pin = String(100000 + (randomBytes(3).readUIntBE(0, 3) % 899999));
  const managerName = `مدير ${randomUUID().slice(0, 8)}`;
  const { pinHash, pinSalt } = hashPin(pin) as { pinHash: string; pinSalt: string };
  const deviceId = randomUUID();
  sql(
    `insert into devices (id, company_id, name, prefix, kind, max_role) values (${q(deviceId)}, ${q(COMPANY)}, 'e2e', ${q(prefix)}, 'pc', 'manager')`,
  );
  sql(
    `insert into device_activations (device_id, code_hash, expires_at) values (${q(deviceId)}, encode(extensions.digest(${q(code)}, 'sha256'), 'hex'), now() + interval '1 day')`,
  );
  sql(
    `insert into workers (id, company_id, name, role, pin_hash, pin_salt, active) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(managerName)}, 'manager', ${q(pinHash)}, ${q(pinSalt)}, true)`,
  );
  return { deviceId, code, pin, managerName, prefix };
}

export const productId = (n: number): string =>
  `a0000000-0000-7000-8000-00000000${String(n).padStart(4, '0')}`;
const CATEGORY = 'a0000000-0000-7000-8000-0000000ca001';

export interface CashierFixture extends Fixture {
  cashierName: string;
  cashierPin: string;
}

/**
 * A device with a drawer, a cashier with a PIN, one category holding products 1..8 (prices 12.50, 15.00, 17.50, 20.00, 22.50...),
 * barcodes 9000001..9000003 for products 1..3, and the default settings (no discount, no price change for the cashier).
 */
export function newCashierFixture(): CashierFixture {
  const f = newFixture();
  const cashierName = `كاشير ${randomUUID().slice(0, 8)}`;
  const cashierPin = String(100000 + (randomBytes(3).readUIntBE(0, 3) % 899999));
  const { pinHash, pinSalt } = hashPin(cashierPin) as { pinHash: string; pinSalt: string };
  sql(
    `insert into workers (id, company_id, name, role, pin_hash, pin_salt, active) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(cashierName)}, 'cashier', ${q(pinHash)}, ${q(pinSalt)}, true)`,
  );
  sql(
    `insert into cash_accounts (id, company_id, name, kind, owner_device_id) values (${q(randomUUID())}, ${q(COMPANY)}, 'درج اختبار', 'drawer', ${q(f.deviceId)})`,
  );
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
  return { ...f, cashierName, cashierPin };
}

/** Same as the default settings plus whatever the test changes (values are JSON). */
export function setSetting(key: string, value: string): void {
  sql(
    `insert into settings (id, company_id, key, value) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(key)}, ${q(value)}::jsonb) on conflict (company_id, key) do update set value = excluded.value`,
  );
}

/** A worker of the given role with a known PIN, on the company (any device with a high enough max role can list him). */
export function addWorker(role: 'cashier' | 'storekeeper' | 'manager'): { name: string; pin: string } {
  const pin = String(100000 + (randomBytes(3).readUIntBE(0, 3) % 899999));
  const name = `${role === 'storekeeper' ? 'أمين' : role === 'cashier' ? 'كاشير' : 'مدير'} ${randomUUID().slice(0, 8)}`;
  const { pinHash, pinSalt } = hashPin(pin) as { pinHash: string; pinSalt: string };
  sql(
    `insert into workers (id, company_id, name, role, pin_hash, pin_salt, active) values (${q(randomUUID())}, ${q(COMPANY)}, ${q(name)}, ${q(role)}, ${q(pinHash)}, ${q(pinSalt)}, true)`,
  );
  return { name, pin };
}
