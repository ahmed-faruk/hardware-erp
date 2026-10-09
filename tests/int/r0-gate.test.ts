import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { openShift } from '@/db/commands/open-shift';
import { postSale } from '@/db/commands/post-sale';
import { pullAll } from '@/sync/pull';
import { pushAll } from '@/sync/push';

import { IDS, pullMasterData, signInDevice, sql, type TestDevice } from './server';

const SALES_PER_DEVICE = 500;

async function sellOffline(d: TestDevice, shiftId: string, drawerId: string): Promise<void> {
  for (let i = 0; i < SALES_PER_DEVICE; i++) {
    const productNo = (i % 5) + 1;
    const credit = i % 2 === 1;
    const qty = 1000 * ((i % 3) + 1);
    const unitPrice = 1000 + productNo * 250;
    const total = (qty * unitPrice) / 1000;
    const r = await postSale(d.ctx, {
      lines: [{ productId: IDS.product(productNo), qtyMilli: qty, unitPrice }],
      customerId: credit ? IDS.customer : null,
      payments: [
        credit
          ? { method: 'credit', amount: total }
          : { method: 'cash', amount: total, tendered: total + 500 },
      ],
      warehouseId: IDS.warehouse,
      shiftId,
      cashAccountId: drawerId,
      isOffline: true,
    });
    if (!r.ok) throw new Error(`sale ${i} failed: ${r.code}`);
  }
}

describe('R0 gate: 1,000 invoices on two offline devices', () => {
  it('syncs with zero loss, zero duplicates and identical balances', async () => {
    const k1 = await signInDevice('K1', 'cashier', IDS.cashierWorker);
    const k2 = await signInDevice('K2', 'cashier', IDS.cashierWorker);
    await pullMasterData(k1);
    await pullMasterData(k2);
    expect(await k1.ctx.db.products.count()).toBe(20);

    const shifts = await Promise.all([
      openShift(k1.ctx, { cashAccountId: IDS.drawers.K1, openingFloat: 10000 }),
      openShift(k2.ctx, { cashAccountId: IDS.drawers.K2, openingFloat: 10000 }),
    ]);
    if (!shifts[0].ok || !shifts[1].ok) throw new Error('shift');

    // both devices are "offline": nothing is pushed or pulled while they sell
    await sellOffline(k1, shifts[0].id, IDS.drawers.K1);
    await sellOffline(k2, shifts[1].id, IDS.drawers.K2);

    const p1 = await pushAll(k1.ctx.db, k1.client, k1.ctx.deviceId, 'test');
    const p2 = await pushAll(k2.ctx.db, k2.client, k2.ctx.deviceId, 'test');
    expect(p1).toMatchObject({ rejected: 0, more: false });
    expect(p2).toMatchObject({ rejected: 0, more: false });
    expect((await pullAll(k1.ctx.db, k1.client)).ok).toBe(true);
    expect((await pullAll(k2.ctx.db, k2.client)).ok).toBe(true);

    // server: exactly 1,000 invoices, no duplicate ids or numbers, ledger rows match
    const count = (q: string): number => Number(sql(q));
    expect(count(`select count(*) from sales_invoices where number like 'K_-INV-%'`)).toBe(1000);
    expect(count(`select count(*) - count(distinct id) from sales_invoices`)).toBe(0);
    expect(count(`select count(*) - count(distinct number) from sales_invoices`)).toBe(0);
    expect(count(`select count(*) from sales_invoice_lines`)).toBe(1000);
    expect(count(`select count(*) from stock_movements`)).toBe(1000);
    expect(count(`select count(*) from party_ledger`)).toBe(500);
    expect(count(`select count(*) from cash_movements`)).toBe(500);
    expect(count(`select count(*) from payments`)).toBe(1000);

    // every device sees all 1,000 invoices
    expect(await k1.ctx.db.salesInvoices.count()).toBe(1000);
    expect(await k2.ctx.db.salesInvoices.count()).toBe(1000);

    // balances: device A == device B == server
    const serverStock = Object.fromEntries(
      sql(`select product_id || '|' || sum(qty) from stock_movements group by product_id`)
        .split('\n')
        .map((l) => l.split('|') as [string, string]),
    );
    for (const d of [k1, k2]) {
      const balances = await d.ctx.db.stockBalances.toArray();
      expect(balances).toHaveLength(Object.keys(serverStock).length);
      for (const b of balances) expect(String(b.qty)).toBe(serverStock[b.productId]);
    }
    const serverCustomer = count(
      `select coalesce(sum(amount), 0) from party_ledger where party_id = '${IDS.customer}'`,
    );
    expect((await k1.ctx.db.partyBalances.get(['customer', IDS.customer]))?.amount).toBe(serverCustomer);
    expect((await k2.ctx.db.partyBalances.get(['customer', IDS.customer]))?.amount).toBe(serverCustomer);
    for (const drawer of [IDS.drawers.K1, IDS.drawers.K2]) {
      const server = count(
        `select coalesce(sum(amount), 0) from cash_movements where cash_account_id = '${drawer}'`,
      );
      for (const d of [k1, k2]) {
        const local = (await d.ctx.db.cashMovements.where('cashAccountId').equals(drawer).toArray()).reduce(
          (a, m) => a + m.amount,
          0,
        );
        expect(local).toBe(server);
      }
    }

    // pushing again, or re-sending every row, changes nothing (idempotent)
    await k1.ctx.db.outbox.toCollection().modify({ status: 'pending' });
    expect(await pushAll(k1.ctx.db, k1.client, k1.ctx.deviceId, 'test')).toMatchObject({ rejected: 0 });
    expect(count(`select count(*) from sales_invoices where number like 'K_-INV-%'`)).toBe(1000);
    expect(count(`select count(*) from stock_movements`)).toBe(1000);
  }, 600_000);
});
