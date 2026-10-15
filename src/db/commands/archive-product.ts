import { err, type Err } from '@/domain/result';

import { auditRow } from './audit';
import { canCtx, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import { patchIndex, tokensOf } from '../search';

/**
 * Archive (a «delete» of a product that has invoices): allowed only at stock 0, for the holder of `archiveProduct`.
 * The product, its barcodes and pack unit are soft-deleted; documents and reports keep its name.
 * The server re-checks the stock and the permission (E_IN_USE / E_FORBIDDEN).
 */
export async function archiveProduct(ctx: DeviceContext, productId: string): Promise<{ ok: true } | Err> {
  if (canCtx(ctx, 'archiveProduct') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction(
    'rw',
    [
      db.products,
      db.barcodes,
      db.productUnits,
      db.searchIndex,
      db.outbox,
      db.syncState,
      db.auditLog,
      db.stockBalances,
    ],
    async (): Promise<{ ok: true } | Err> => {
      const product = await db.products.get(productId);
      if (!product || product.deletedAt) return err('NOT_FOUND', 'الصنف مش موجود');
      const stock = (await db.stockBalances.filter((b) => b.productId === productId).toArray()).reduce(
        (a, b) => a + b.qty,
        0,
      );
      if (stock !== 0) return err('HAS_STOCK', 'فيه رصيد');
      const before = await tokensOf(db, productId);
      const now = nowIso();
      const tombstone = <R extends { version: number }>(row: R): R => ({
        ...row,
        deletedAt: now,
        updatedAt: now,
        version: row.version + 1,
      });
      const gone = tombstone(product);
      await db.products.put(gone);
      await enqueue(db, 'products', gone, ctx.workerId, {
        changedFields: ['deletedAt'],
        baseVersion: product.version,
      });
      for (const b of (await db.barcodes.where('productId').equals(productId).toArray()).filter(
        (x) => !x.deletedAt,
      )) {
        const t = tombstone(b);
        await db.barcodes.put(t);
        await enqueue(db, 'barcodes', t, ctx.workerId, {
          changedFields: ['deletedAt'],
          baseVersion: b.version,
        });
      }
      for (const u of (await db.productUnits.where('productId').equals(productId).toArray()).filter(
        (x) => !x.deletedAt,
      )) {
        const t = tombstone(u);
        await db.productUnits.put(t);
        await enqueue(db, 'productUnits', t, ctx.workerId, {
          changedFields: ['deletedAt'],
          baseVersion: u.version,
        });
      }
      await patchIndex(db, productId, before);
      const audit = auditRow(ctx, 'product.archive', 'products', productId, { name: product.name });
      await db.auditLog.add(audit);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true };
    },
  );
}

/**
 * Bring an archived product back with its barcodes and pack unit (the ones archived with it). A barcode that another live
 * product took meanwhile stays off and is reported; a taken SKU refuses the restore.
 */
export async function restoreProduct(
  ctx: DeviceContext,
  productId: string,
): Promise<{ ok: true; skippedBarcodes: string[] } | Err> {
  if (canCtx(ctx, 'archiveProduct') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction(
    'rw',
    [db.products, db.barcodes, db.productUnits, db.searchIndex, db.outbox, db.syncState, db.auditLog],
    async (): Promise<{ ok: true; skippedBarcodes: string[] } | Err> => {
      const product = await db.products.get(productId);
      if (!product || !product.deletedAt) return err('NOT_FOUND', 'الصنف مش متأرشف');
      const archivedAt = product.deletedAt;
      if (product.sku) {
        const taken = await db.products
          .where('sku')
          .equals(product.sku)
          .filter((p) => !p.deletedAt && p.id !== productId)
          .count();
        if (taken > 0) return err('SKU_TAKEN', 'الكود ده متاخد لصنف تاني');
      }
      const before = await tokensOf(db, productId);
      const now = nowIso();
      const revive = <R extends { version: number }>(row: R): R => ({
        ...row,
        deletedAt: null,
        updatedAt: now,
        version: row.version + 1,
      });
      const back = revive(product);
      await db.products.put(back);
      await enqueue(db, 'products', back, ctx.workerId, {
        changedFields: ['deletedAt'],
        baseVersion: product.version,
      });
      const skippedBarcodes: string[] = [];
      for (const b of (await db.barcodes.where('productId').equals(productId).toArray()).filter(
        (x) => x.deletedAt && x.deletedAt >= archivedAt,
      )) {
        const taken = await db.barcodes
          .where('code')
          .equals(b.code)
          .filter((x) => !x.deletedAt && x.productId !== productId)
          .count();
        if (taken > 0) {
          skippedBarcodes.push(b.code);
          continue;
        }
        const t = revive(b);
        await db.barcodes.put(t);
        await enqueue(db, 'barcodes', t, ctx.workerId, {
          changedFields: ['deletedAt'],
          baseVersion: b.version,
        });
      }
      for (const u of (await db.productUnits.where('productId').equals(productId).toArray()).filter(
        (x) => x.deletedAt && x.deletedAt >= archivedAt,
      )) {
        const t = revive(u);
        await db.productUnits.put(t);
        await enqueue(db, 'productUnits', t, ctx.workerId, {
          changedFields: ['deletedAt'],
          baseVersion: u.version,
        });
      }
      await patchIndex(db, productId, before);
      const audit = auditRow(ctx, 'product.restore', 'products', productId, {
        name: product.name,
        skippedBarcodes,
      });
      await db.auditLog.add(audit);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, skippedBarcodes };
    },
  );
}
