import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postSale } from '@/db/commands/post-sale';
import { checkVerifier, hasVerifier, saveVerifier } from '@/db/login';
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

describe('offline login verifier', () => {
  it('accepts the password it was saved with, refuses another, and knows a worker it never saw', async () => {
    const ctx = newDevice();
    expect(await hasVerifier(ctx.db, 'boss')).toBe(false);
    await saveVerifier(ctx.db, 'Boss', ctx.workerId, 'secret1');
    expect(await hasVerifier(ctx.db, ' boss ')).toBe(true);
    expect(await checkVerifier(ctx.db, 'boss', 'secret1')).toBe(ctx.workerId);
    expect(await checkVerifier(ctx.db, 'boss', 'secret2')).toBeNull();
    expect(await checkVerifier(ctx.db, 'nobody', 'secret1')).toBeNull();
    // the stored value never holds the password itself
    expect(JSON.stringify(await ctx.db.deviceSettings.toArray())).not.toContain('secret1');
  });
});
