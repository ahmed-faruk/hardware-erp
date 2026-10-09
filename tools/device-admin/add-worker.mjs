// Mac-only: creates a worker (for the first manager, before the app has a workers screen) with a PIN typed here.
// Usage: npm run worker:add -- --name "المدير" --role manager [--company <uuid>]
// Reads TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_ROLE_KEY from tools/device-admin/.env.local (git-ignored).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { hashPin, promptHidden } from './pin.mjs';

const envFile = fileURLToPath(new URL('./.env.local', import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const { name, role = 'cashier', company } = args;
if (!name || !['cashier', 'storekeeper', 'manager'].includes(role)) {
  console.error('Usage: npm run worker:add -- --name "<name>" --role cashier|storekeeper|manager [--company <uuid>]');
  process.exit(1);
}
const url = process.env.TARGET_SUPABASE_URL;
const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY in tools/device-admin/.env.local');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const fail = (what, error) => {
  console.error(`${what}: ${error.message}`);
  process.exit(1);
};

let companyId = company;
if (!companyId) {
  const { data, error } = await db.from('companies').select('id').limit(2);
  if (error) fail('companies', error);
  if (data.length !== 1) fail('companies', new Error(`expected exactly one company, found ${data.length}; pass --company <uuid>`));
  companyId = data[0].id;
}

const pin = await promptHidden('PIN (6-12 digits): ');
if (pin !== (await promptHidden('Repeat the PIN: '))) {
  console.error('The two PINs differ; nothing was created.');
  process.exit(1);
}
const { pinHash, pinSalt } = hashPin(pin);
const { error } = await db.from('workers').insert({ id: randomUUID(), company_id: companyId, name, role, pin_hash: pinHash, pin_salt: pinSalt, active: true });
if (error) fail('worker', error);
console.log(`\nWorker "${name}" (${role}) created.\n`);
