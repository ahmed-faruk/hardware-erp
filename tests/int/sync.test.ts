import 'fake-indexeddb/auto';

import { afterAll, describe, expect, it } from 'vitest';

import { saveProduct } from '@/db/commands/save-product';
import { nowIso, uuidv7 } from '@/db/ids';
import { enqueue } from '@/db/outbox';
import { pullAll } from '@/sync/pull';
import { pushAll } from '@/sync/push';

import { IDS, pullMasterData, signInDevice, sql } from './server';

const manager = () => signInDevice('K1', 'manager', IDS.managerWorker);
const edit = async (d: Awaited<ReturnType<typeof manager>>, productNo: number, fields: object) => {
  const r = await saveProduct(d.ctx, { id: IDS.product(productNo), fields });
  if (!r.ok) throw new Error(r.code);
};
const sync = async (d: Awaited<ReturnType<typeof manager>>) => {
  await pushAll(d.ctx.db, d.client, d.ctx.deviceId, 'test');
  await pullAll(d.ctx.db, d.client);
};

describe('master data sync', () => {
  it('an edit on one device reaches the other', async () => {
    const a = await manager();
    const b = await signInDevice('K2', 'manager', IDS.managerWorker);
    await pullMasterData(a);
    await pullMasterData(b);
    await edit(a, 10, { price: 7777 });
    await sync(a);
    await sync(b);
    expect((await b.ctx.db.products.get(IDS.product(10)))?.price).toBe(7777);
  });

  it('field conflict: the older edit loses and the conflict is logged', async () => {
    const a = await manager();
    const b = await signInDevice('K2', 'manager', IDS.managerWorker);
    await pullMasterData(a);
    await pullMasterData(b);
    await edit(b, 11, { price: 1111 }); // made first (older client time)
    await new Promise((r) => setTimeout(r, 20));
    await edit(a, 11, { price: 2222 }); // made later
    await sync(a); // server now has 2222
    await sync(b); // stale base version, older edit: server value kept
    expect(sql(`select price from products where id = '${IDS.product(11)}'`)).toBe('2222');
    expect(
      sql(
        `select count(*) from audit_log where entity_id = '${IDS.product(11)}' and action = 'sync_conflict:server_won'`,
      ),
    ).toBe('1');
    expect((await b.ctx.db.products.get(IDS.product(11)))?.price).toBe(2222);
  });

  it('field conflict: a newer edit wins and the other fields merge', async () => {
    const a = await manager();
    const b = await signInDevice('K2', 'manager', IDS.managerWorker);
    await pullMasterData(a);
    await pullMasterData(b);
    await edit(a, 12, { name: 'renamed by A' });
    await sync(a);
    await new Promise((r) => setTimeout(r, 20));
    await edit(b, 12, { price: 3333 }); // b never pulled A's rename, but its edit is newer than the server row
    await sync(b);
    expect(sql(`select price || '|' || name from products where id = '${IDS.product(12)}'`)).toBe(
      '3333|renamed by A',
    );
  });

  it('a tombstone hides the record on the other device and is never a hard delete', async () => {
    const a = await manager();
    const b = await signInDevice('K2', 'manager', IDS.managerWorker);
    await pullMasterData(a);
    await pullMasterData(b);
    await edit(a, 13, { deletedAt: nowIso() });
    await sync(a);
    await sync(b);
    expect((await b.ctx.db.products.get(IDS.product(13)))?.deletedAt).not.toBeNull();
    expect(sql(`select count(*) from products where id = '${IDS.product(13)}'`)).toBe('1');
  });
});

describe('permissions and failures', () => {
  it('cashier devices never receive cost data', async () => {
    const phone = await signInDevice('M1', 'cashier', IDS.cashierWorker);
    await pullMasterData(phone);
    const products = await phone.ctx.db.products.toArray();
    expect(products.length).toBeGreaterThanOrEqual(20);
    expect(products.every((p) => p.unitCost === undefined)).toBe(true);
  });

  it('a rejected row does not block the rows after it', async () => {
    const phone = await signInDevice('M1', 'cashier', IDS.cashierWorker);
    const { db } = phone.ctx;
    await db.transaction('rw', [db.outbox, db.syncState], async () => {
      // a cashier may not change products (server re-checks the permission matrix)
      await enqueue(
        db,
        'products',
        { id: IDS.product(14), createdBy: IDS.cashierWorker, price: 1 },
        IDS.cashierWorker,
        { changedFields: ['price'], baseVersion: 1 },
      );
      await enqueue(
        db,
        'auditLog',
        {
          id: uuidv7(),
          createdBy: IDS.cashierWorker,
          action: 'test',
          entity: 'x',
          entityId: null,
          workerId: IDS.cashierWorker,
          occurredAt: nowIso(),
        },
        IDS.cashierWorker,
      );
    });
    const r = await pushAll(db, phone.client, phone.ctx.deviceId, 'test');
    expect(r).toMatchObject({ sent: 1, rejected: 1 });
    const rows = await db.outbox.orderBy('seq').toArray();
    expect(rows.map((o) => o.status)).toEqual(['rejected', 'sent']);
    expect(rows[0]?.lastError).toContain('E_FORBIDDEN');
  });

  describe('revoked device', () => {
    afterAll(() => {
      sql(`update devices set revoked_at = null where id = '${IDS.devices.M1}'`);
    });
    it('is refused by every call', async () => {
      const phone = await signInDevice('M1', 'cashier', IDS.cashierWorker);
      sql(`update devices set revoked_at = now() where id = '${IDS.devices.M1}'`);
      const pulled = await pullAll(phone.ctx.db, phone.client);
      expect(pulled).toMatchObject({ ok: false, code: 'E_DEVICE_REVOKED' });
    });
  });
});
