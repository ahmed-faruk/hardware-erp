import { execFileSync } from 'node:child_process';

import type { SupabaseClient } from '@supabase/supabase-js';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { HanafyDB } from '@/db/schema';
import { createSupabase } from '@/sync/supabase';
import { pullAll } from '@/sync/pull';

/** Local Supabase (`supabase start`). Only the public API URL and anon key are read; never the service_role key. */
function localEnv(): { url: string; anonKey: string } {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return { url: process.env.VITE_SUPABASE_URL, anonKey: process.env.VITE_SUPABASE_ANON_KEY };
  }
  const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const pick = (k: string): string => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out)?.[1] ?? '';
  return { url: pick('API_URL'), anonKey: pick('ANON_KEY') };
}

export const A = (n: string): string => `a0000000-0000-7000-8000-${n}`;
export const IDS = {
  company: A('000000000001'),
  warehouse: A('0000000000c1'),
  cashierWorker: A('0000000000d1'),
  managerWorker: A('0000000000d3'),
  customer: A('000000000c01'),
  devices: { K1: A('0000000000f1'), K2: A('0000000000f2'), M1: A('0000000000f3') },
  drawers: { K1: A('000000000a11'), K2: A('000000000a12') },
  product: (n: number): string => A(`00000000${String(n).padStart(4, '0')}`),
};

export interface TestDevice {
  ctx: DeviceContext;
  client: SupabaseClient;
}

/** A simulated shop device: its own IndexedDB and its own signed-in Supabase session. */
export async function signInDevice(
  prefix: 'K1' | 'K2' | 'M1',
  role: DeviceContext['role'],
  workerId: string,
): Promise<TestDevice> {
  const { url, anonKey } = localEnv();
  const client = createSupabase(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: `${prefix.toLowerCase()}@devices.test.local`,
    password: 'local-test-password',
  });
  if (error) throw new Error(`device sign-in failed: ${error.message}`);
  const db = new HanafyDB(`int-${prefix}-${Math.random().toString(36).slice(2)}`);
  return {
    ctx: { db, companyId: IDS.company, deviceId: IDS.devices[prefix], devicePrefix: prefix, workerId, role },
    client,
  };
}

/** Test-only superuser query against the local database container (never used against staging or production). */
export function sql(query: string): string {
  const container = execFileSync('docker', ['ps', '-qf', 'name=supabase_db_hardware-erp'], {
    encoding: 'utf8',
  }).trim();
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-At', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

export async function pullMasterData(d: TestDevice): Promise<void> {
  const r = await pullAll(d.ctx.db, d.client);
  if (!r.ok) throw new Error(`pull failed: ${r.message}`);
}

export { newCommon };
