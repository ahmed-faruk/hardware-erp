import { err, type Err } from '@/domain/result';
import { usageReasons } from '@/domain/product-usage';

import { auditRow } from './audit';
import { canCtx, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import { localProductUsage } from '../product-usage';
import { patchIndex, tokensOf } from '../search';

/**
 * Deletes a product that never moved: no sale, purchase, return, stock movement or stock, here or in the old history.
 * The old history lives on the server only, so the screen asks the server first (RPC product_usage) and the server
 * refuses the delete again (E_IN_USE). This command checks what this device knows, then soft-deletes the product with
 * its barcodes and pack unit and writes an audit row, in ONE transaction.
 */
export async function deleteProduct(
  ctx: DeviceContext,
  productId: string,
): Promise<{ ok: true } | (Err & { reasons?: string[] })> {
  if (canCtx(ctx, 'editProductData') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
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
      db.salesInvoiceLines,
      db.salesReturnLines,
      db.purchaseInvoiceLines,
      db.purchaseReturnLines,
      db.stockAdjustmentLines,
      db.stockMovements,
    ],
    async (): Promise<{ ok: true } | (Err & { reasons?: string[] })> => {
      const product = await db.products.get(productId);
      if (!product || product.deletedAt) return err('NOT_FOUND', 'الصنف مش موجود');
      const reasons = usageReasons(await localProductUsage(db, productId));
      if (reasons.length > 0) return { ...err('IN_USE', 'الصنف عليه حركة'), reasons };

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
      const audit = auditRow(ctx, 'product.delete', 'products', productId, { name: product.name });
      await db.auditLog.add(audit);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true };
    },
  );
}
