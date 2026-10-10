import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ACTIONS, can, type Role } from './permissions';

// The server re-checks every push with role_can() in SQL; both tables must stay identical.
const dir = 'supabase/migrations';
// the newest migration that (re)defines role_can wins, like in the database
const latest = readdirSync(dir)
  .filter((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('function role_can'))
  .sort()
  .at(-1) as string;
const sql = readFileSync(`${dir}/${latest}`, 'utf8');
const rows = [...sql.matchAll(/\('(cashier|storekeeper)', '(\w+)', '(yes|pin)'\)/g)].map((m) => ({
  role: m[1] as Role,
  action: m[2],
  access: m[3],
}));

describe('role_can (SQL) matches permissions.ts', () => {
  it.each(['cashier', 'storekeeper'] as const)('%s', (role) => {
    const fromSql = Object.fromEntries(rows.filter((r) => r.role === role).map((r) => [r.action, r.access]));
    for (const action of ACTIONS) expect(fromSql[action] ?? 'no').toBe(can(role, action));
  });
});
