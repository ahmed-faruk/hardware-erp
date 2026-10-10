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
  return { code, pin, managerName, prefix };
}
