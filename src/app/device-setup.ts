import type { SupabaseClient } from '@supabase/supabase-js';

import type { HanafyDB } from '@/db/schema';
import { err, ok, type Result } from '@/domain/result';
import { callRpc } from '@/sync/errors';
import { pullAll } from '@/sync/pull';

export interface DeviceIdentity {
  deviceId: string;
  companyId: string;
  prefix: string;
  maxRole: 'cashier' | 'storekeeper' | 'manager';
  /** the device's own Supabase login: random, created on this device, never shown or typed */
  authEmail: string;
  authPassword: string;
}

const KEY = 'device';

export async function loadIdentity(db: HanafyDB): Promise<DeviceIdentity | null> {
  return ((await db.deviceSettings.get(KEY))?.value as DeviceIdentity | undefined) ?? null;
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * First run: the manager registered this device on the Mac and read out a one-time code. The device creates its own
 * login, claims the code, stores its identity, and pulls everything (docs/API.md §2, claim_device_activation).
 */
export async function activateDevice(
  db: HanafyDB,
  client: SupabaseClient,
  code: string,
): Promise<Result<DeviceIdentity>> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(clean)) return err('BAD_CODE', 'activation code has the wrong shape');
  const authEmail = `device-${randomHex(8)}@hanafy-pos.pages.dev`;
  const authPassword = randomHex(24);
  const signUp = await client.auth.signUp({ email: authEmail, password: authPassword });
  if (signUp.error) return err('NO_NET', signUp.error.message);
  if (!signUp.data.session)
    return err(
      'CONFIRMATION_REQUIRED',
      'the server requires email confirmation: disable it in the Supabase auth settings',
    );
  const claim = await callRpc<{
    device_id: string;
    company_id: string;
    prefix: string;
    max_role: DeviceIdentity['maxRole'];
  }>(client, 'claim_device_activation', { p_code: clean });
  if (!claim.ok) return err(claim.network ? 'NO_NET' : 'BAD_CODE', claim.message);
  const identity: DeviceIdentity = {
    deviceId: claim.data.device_id,
    companyId: claim.data.company_id,
    prefix: claim.data.prefix,
    maxRole: claim.data.max_role,
    authEmail,
    authPassword,
  };
  await db.deviceSettings.put({ key: KEY, value: identity });
  const pulled = await pullAll(db, client);
  if (!pulled.ok) return err('PULL_FAILED', pulled.message);
  return ok(identity);
}

/** Restores the device login when the stored session expired (needs a connection; selling does not). */
export async function signInDevice(client: SupabaseClient, identity: DeviceIdentity): Promise<boolean> {
  const { data } = await client.auth.getSession();
  if (data.session) return true;
  const { error } = await client.auth.signInWithPassword({
    email: identity.authEmail,
    password: identity.authPassword,
  });
  return !error;
}
