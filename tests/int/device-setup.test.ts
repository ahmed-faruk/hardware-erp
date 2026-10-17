import 'fake-indexeddb/auto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { firstLogin, signInDevice, type DeviceIdentity } from '@/app/device-setup';

import { newDevice } from './helpers';

const identity: DeviceIdentity = {
  deviceId: 'd',
  companyId: 'c',
  prefix: 'K1',
  maxRole: 'manager',
  authEmail: 'device-own@x.test',
  authPassword: 'pw',
};

function client(
  sessionEmail: string | null,
  rpcResult: unknown = { data: { ok: true, data: {} }, error: null },
) {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: sessionEmail ? { user: { email: sessionEmail } } : null },
      })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ error: null, data: { session: { user: { email: 'new@x.test' } } } })),
    },
    rpc: vi.fn(async () => rpcResult),
  };
}

describe('signInDevice', () => {
  it('keeps the session when it is the device own login', async () => {
    const c = client(identity.authEmail);
    expect(await signInDevice(c as unknown as SupabaseClient, identity)).toBe(true);
    expect(c.auth.signOut).not.toHaveBeenCalled();
    expect(c.auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it('replaces the session of another user (left behind by a repeated activation)', async () => {
    const c = client('device-orphan@x.test');
    expect(await signInDevice(c as unknown as SupabaseClient, identity)).toBe(true);
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(c.auth.signInWithPassword).toHaveBeenCalledWith({
      email: identity.authEmail,
      password: identity.authPassword,
    });
  });
  it('signs in when there is no session', async () => {
    const c = client(null);
    await signInDevice(c as unknown as SupabaseClient, identity);
    expect(c.auth.signOut).not.toHaveBeenCalled();
    expect(c.auth.signInWithPassword).toHaveBeenCalled();
  });
});

describe('firstLogin', () => {
  it('drops the throw-away login when the password is refused, and stores nothing', async () => {
    const { db } = newDevice();
    const c = client(null, {
      data: { ok: false, error: { code: 'E_LOGIN', message: 'x' } },
      error: null,
    });
    const r = await firstLogin(db, c as unknown as SupabaseClient, 'boss', 'wrong-pass');
    expect(r).toMatchObject({ ok: false, code: 'BAD_LOGIN' });
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await db.deviceSettings.get('device')).toBeUndefined();
  });
  it('says LOCKED when the server locks the username', async () => {
    const { db } = newDevice();
    const c = client(null, {
      data: { ok: false, error: { code: 'E_LOCKED', message: 'x' } },
      error: null,
    });
    expect(await firstLogin(db, c as unknown as SupabaseClient, 'boss', 'pw12345')).toMatchObject({
      ok: false,
      code: 'LOCKED',
    });
  });
  it('refuses an empty username or password before touching the network', async () => {
    const { db } = newDevice();
    const c = client(null);
    expect(await firstLogin(db, c as unknown as SupabaseClient, '', 'x')).toMatchObject({
      ok: false,
      code: 'BAD_LOGIN',
    });
    expect(c.auth.signUp).not.toHaveBeenCalled();
  });
});
