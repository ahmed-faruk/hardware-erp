import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { checkPin } from '@/db/workers';

// @ts-expect-error plain JS module shared with the Mac admin tools
import { hashPin } from '../../tools/device-admin/pin.mjs';

import { newDevice } from './helpers';

describe('Mac tool PIN hash', () => {
  it('verifies with the app (same PBKDF2 parameters)', async () => {
    const ctx = newDevice();
    const { pinHash, pinSalt } = hashPin('482915') as { pinHash: string; pinSalt: string };
    await ctx.db.workers.put({
      id: ctx.workerId,
      companyId: ctx.companyId,
      deviceId: null,
      createdBy: null,
      createdAt: '',
      updatedAt: '',
      version: 1,
      deletedAt: null,
      name: 'm',
      role: 'manager',
      pinHash,
      pinSalt,
      photoPath: null,
      active: true,
      legacyEmployeeId: null,
    });
    expect(await checkPin(ctx, ctx.workerId, '482915')).toMatchObject({ ok: true });
    expect(await checkPin(ctx, ctx.workerId, '000000')).toMatchObject({ ok: false, code: 'PIN_WRONG' });
  });
  it('refuses a short PIN', () => {
    expect(() => hashPin('1234')).toThrow();
  });
});
