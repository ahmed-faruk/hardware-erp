import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postSale } from '@/db/commands/post-sale';
import { checkPin, hashPin } from '@/db/workers';
import { HanafyDB } from '@/db/schema';
import { exportBackup, restoreBackup } from '@/sync/backup';

import { newDevice, seedCatalog } from './helpers';

describe('backup', () => {
  it('round-trips into a fresh database and restoring twice duplicates nothing', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    await postSale(ctx, {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: 1000 }],
      warehouseId: s.warehouseId,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    });
    const data = await exportBackup(ctx.db, 'pass-1234');
    const fresh = new HanafyDB(`restore-${Math.random()}`);
    expect(await restoreBackup(fresh, data, 'pass-1234')).toMatchObject({ ok: true });
    expect(await restoreBackup(fresh, data, 'pass-1234')).toMatchObject({ ok: true });
    expect(await fresh.salesInvoices.count()).toBe(1);
    expect(await fresh.stockMovements.count()).toBe(1);
    expect(await fresh.outbox.count()).toBe(await ctx.db.outbox.count());
  });

  it('refuses a wrong passphrase and tampered data', async () => {
    const ctx = newDevice();
    const data = await exportBackup(ctx.db, 'right');
    expect(await restoreBackup(newDevice().db, data, 'wrong')).toMatchObject({
      ok: false,
      code: 'BACKUP_WRONG_PASSPHRASE',
    });
    const tampered = data.slice();
    tampered[tampered.length - 1]! ^= 1;
    expect(await restoreBackup(newDevice().db, tampered, 'right')).toMatchObject({ ok: false });
  });
});

describe('worker PIN', () => {
  it('accepts the right PIN, locks after 5 wrong tries, audits the lock', async () => {
    const ctx = newDevice();
    const { pinHash, pinSalt } = await hashPin('123456');
    await ctx.db.workers.put({
      id: ctx.workerId,
      companyId: ctx.companyId,
      deviceId: null,
      createdBy: null,
      createdAt: '',
      updatedAt: '',
      version: 1,
      deletedAt: null,
      name: 'w',
      role: 'cashier',
      pinHash,
      pinSalt,
      photoPath: null,
      active: true,
      legacyEmployeeId: null,
    });
    expect(await checkPin(ctx, ctx.workerId, '123456')).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++)
      expect(await checkPin(ctx, ctx.workerId, '000000')).toMatchObject({ code: 'PIN_WRONG' });
    expect(await checkPin(ctx, ctx.workerId, '000000', 1_000)).toMatchObject({ code: 'PIN_LOCKED' });
    expect(await checkPin(ctx, ctx.workerId, '123456', 2_000)).toMatchObject({ code: 'PIN_LOCKED' });
    expect((await ctx.db.auditLog.toArray()).filter((a) => a.action === 'pin_locked')).toHaveLength(1);
    expect(await checkPin(ctx, ctx.workerId, '123456', Date.now() + 6 * 60_000)).toMatchObject({ ok: true });
  });
});
