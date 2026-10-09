// Mac-only: registers a shop device and prints a one-time activation code (valid 24 h).
// Usage: npm run device:add -- --name "كاشير 1" --prefix K1 --kind pc --role manager [--company <uuid>]
// --company is only needed when the database holds more than one company (local test seed).
// Reads TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_ROLE_KEY from tools/device-admin/.env.local (git-ignored).
// The service_role key is used only here; it never enters src/, tests or CI.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const envFile = fileURLToPath(new URL('./.env.local', import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const { name, prefix, kind = 'pc', role = 'cashier', company } = args;
if (
  !name ||
  !/^[A-Z0-9]{2,3}$/.test(prefix ?? '') ||
  !['pc', 'mobile'].includes(kind) ||
  !['cashier', 'storekeeper', 'manager'].includes(role)
) {
  console.error(
    'Usage: npm run device:add -- --name "<name>" --prefix <2-3 chars A-Z0-9> --kind pc|mobile --role cashier|storekeeper|manager',
  );
  process.exit(1);
}
const url = process.env.TARGET_SUPABASE_URL;
const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Missing TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY in tools/device-admin/.env.local',
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const fail = (what, error) => {
  console.error(`${what}: ${error.message}`);
  process.exit(1);
};

let companyId = company;
if (!companyId) {
  const { data: companies, error: cErr } = await db.from('companies').select('id').limit(2);
  if (cErr) fail('companies', cErr);
  if (companies.length !== 1)
    fail(
      'companies',
      new Error(`expected exactly one company, found ${companies.length}; pass --company <uuid>`),
    );
  companyId = companies[0].id;
}

// unambiguous alphabet (no 0/O, 1/I): easy to read out and type
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');

const deviceId = randomUUID();
const { error: dErr } = await db
  .from('devices')
  .insert({ id: deviceId, company_id: companyId, name, prefix, kind, max_role: role });
if (dErr) fail('device', dErr);
const { error: aErr } = await db.from('device_activations').insert({
  device_id: deviceId,
  code_hash: createHash('sha256').update(code).digest('hex'),
  expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
});
if (aErr) fail('activation', aErr);

console.log(
  `\nDevice "${name}" (${prefix}) registered.\nActivation code (valid 24 h, single use):  ${code}\n`,
);
