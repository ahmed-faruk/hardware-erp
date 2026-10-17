import type { SupabaseClient } from '@supabase/supabase-js';

import type { HanafyDB } from '@/db/schema';
import { err, ok, type Result } from '@/domain/result';
import { saveVerifier } from '@/db/login';
import { strings } from '@/ui/strings.ar';
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

export interface FirstLogin {
  identity: DeviceIdentity;
  workerId: string;
  mustChange: boolean;
}

/**
 * First run on a browser: the worker types a username and password. The device creates its own login, asks the server to check
 * the password (and register this browser as a manager device), stores its identity, pulls everything and keeps a local verifier
 * so the same worker can log in again offline (docs/API.md §2, login_device).
 */
export async function firstLogin(
  db: HanafyDB,
  client: SupabaseClient,
  username: string,
  password: string,
): Promise<Result<FirstLogin>> {
  if (!username.trim() || !password) return err('BAD_LOGIN', 'username and password are required');
  const authEmail = `device-${randomHex(8)}@hanafy-pos.pages.dev`;
  const authPassword = randomHex(24);
  const signUp = await client.auth.signUp({ email: authEmail, password: authPassword });
  if (signUp.error) return err('NO_NET', signUp.error.message);
  if (!signUp.data.session)
    return err(
      'CONFIRMATION_REQUIRED',
      'the server requires email confirmation: disable it in the Supabase auth settings',
    );
  const kind =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'pc';
  const claim = await callRpc<{
    device_id: string;
    company_id: string;
    prefix: string;
    max_role: DeviceIdentity['maxRole'];
    worker_id: string;
    must_change: boolean;
  }>(client, 'login_device', {
    p_username: username.trim(),
    p_password: password,
    p_device_name: kind === 'mobile' ? strings.setup.deviceMobile : strings.setup.deviceComputer,
    p_kind: kind,
  });
  if (!claim.ok) {
    await client.auth.signOut({ scope: 'local' });
    return err(claim.network ? 'NO_NET' : claim.code === 'E_LOCKED' ? 'LOCKED' : 'BAD_LOGIN', claim.message);
  }
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
  if (!claim.data.must_change) await saveVerifier(db, username, claim.data.worker_id, password);
  return ok({ identity, workerId: claim.data.worker_id, mustChange: claim.data.must_change });
}

/**
 * Makes sure the Supabase session is THIS device's own login. A failed or repeated activation can leave the session of another,
 * never-claimed user in the browser: every RPC would then be refused as an inactive device, so it is dropped and replaced.
 * Needs a connection only when the session has to be replaced; selling never needs it.
 */
export async function signInDevice(client: SupabaseClient, identity: DeviceIdentity): Promise<boolean> {
  const { data } = await client.auth.getSession();
  if (data.session?.user.email === identity.authEmail) return true;
  if (data.session) await client.auth.signOut({ scope: 'local' });
  const { error } = await client.auth.signInWithPassword({
    email: identity.authEmail,
    password: identity.authPassword,
  });
  return !error;
}
