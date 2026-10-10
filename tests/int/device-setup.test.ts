import 'fake-indexeddb/auto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { activateDevice, signInDevice, type DeviceIdentity } from '@/app/device-setup';

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

describe('activateDevice', () => {
  it('drops the throw-away login when the code is refused, and stores nothing', async () => {
    const { db } = newDevice();
    const c = client(null, {
      data: { ok: false, error: { code: 'E_VALIDATION', message: 'x' } },
      error: null,
    });
    const r = await activateDevice(db, c as unknown as SupabaseClient, 'ABCDEFGHJK');
    expect(r).toMatchObject({ ok: false, code: 'BAD_CODE' });
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await db.deviceSettings.get('device')).toBeUndefined();
  });
  it('refuses a code of the wrong shape before touching the network', async () => {
    const { db } = newDevice();
    const c = client(null);
    expect(await activateDevice(db, c as unknown as SupabaseClient, 'short')).toMatchObject({
      ok: false,
      code: 'BAD_CODE',
    });
    expect(c.auth.signUp).not.toHaveBeenCalled();
  });
});
