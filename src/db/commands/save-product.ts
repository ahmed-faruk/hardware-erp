import { err, type Err } from '@/domain/result';
import { barcodesSchema, packUnitSchema, productFieldsSchema } from '@/domain/schemas';

import { newCommon, type DeviceContext, canCtx } from './context';
import { upsertRow, type SaveResult } from './save-master';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import { patchIndex, tokensOf } from '../search';
import type { Barcode, Product, ProductUnit } from '../types';

export interface SaveProductInput {
  id?: string;
  fields: unknown;
  baseVersion?: number;
  /** the full list of barcodes the product should have; omitted = leave as is */
  barcodes?: string[];
  /** one pack unit (carton, roll...); `null` removes it; omitted = leave as is */
  packUnit?: { name: string; factorMilli: number; price: number | null } | null;
}

/** Product + barcodes + pack unit + search words in ONE transaction. Removed barcodes and units are soft-deleted (synced as tombstones). */
export async function saveProduct(ctx: DeviceContext, input: SaveProductInput): Promise<SaveResult | Err> {
  const fields = productFieldsSchema.safeParse(input.fields);
  const codes = input.barcodes === undefined ? undefined : barcodesSchema.safeParse(input.barcodes);
  const unit = input.packUnit ? packUnitSchema.safeParse(input.packUnit) : undefined;
  if (!fields.success || (codes && !codes.success) || (unit && !unit.success))
    return err('E_VALIDATION', 'بيانات الصنف غير صحيحة');
  if (canCtx(ctx, 'editProductData') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  // a NEW product needs addProduct as well (the storekeeper has it by default; a group can take it away)
  if (!input.id && canCtx(ctx, 'addProduct') !== 'yes') return err('E_FORBIDDEN', 'مينفعش تضيف صنف');
  if (
    ('price' in fields.data ||
      'unitCost' in fields.data ||
      'priceWholesale' in fields.data ||
      'priceCraftsman' in fields.data ||
      'priceContractor' in fields.data) &&
    canCtx(ctx, 'editPrices') !== 'yes'
  ) {
    return err('E_FORBIDDEN', 'الأسعار للمدير فقط');
  }
  const wanted = codes?.success ? [...new Set(codes.data)] : undefined;
  const { db } = ctx;

  return db.transaction(
    'rw',
    [db.products, db.productUnits, db.barcodes, db.searchIndex, db.outbox, db.syncState],
    async (): Promise<SaveResult | Err> => {
      const before = input.id ? await tokensOf(db, input.id) : new Set<string>();
      const current = input.id ? await db.products.get(input.id) : undefined;
      const productFields: Record<string, unknown> = { ...fields.data };
      if (productFields.extraFields && current?.extraFields && typeof current.extraFields === 'object') {
        productFields.extraFields = {
          ...(current.extraFields as object),
          ...(productFields.extraFields as object),
        };
      }

      if (wanted) {
        for (const code of wanted) {
          const taken = await db.barcodes
            .where('code')
            .equals(code)
            .filter((b) => !b.deletedAt && b.productId !== (current?.id ?? ''))
            .count();
          if (taken > 0) return err('DUPLICATE_BARCODE', 'الباركود ده متسجل لصنف تاني');
        }
      }

      const saved = await upsertRow<Product>(ctx, 'products', db.products, input, productFields, () => ({
        ...newCommon(ctx),
        sku: null,
        name: '',
        categoryId: null,
        type: 'stock',
        baseUnitName: 'قطعة',
        qtyDecimals: 0,
        price: 0,
        unitCost: 0,
        reorderLevel: 0,
        defaultSupplierId: null,
        imagePath: null,
        extraFields: null,
        active: true,
        legacyItemId: null,
      }));
      if (!saved.ok) return saved;
      const productId = saved.id;
      const now = nowIso();

      if (wanted) {
        const existing = (await db.barcodes.where('productId').equals(productId).toArray()).filter(
          (b) => !b.deletedAt,
        );
        const added: Barcode[] = wanted
          .filter((code) => !existing.some((b) => b.code === code))
          .map((code) => ({ ...newCommon(ctx), productId, productUnitId: null, code }));
        await db.barcodes.bulkAdd(added);
        for (const row of added) await enqueue(db, 'barcodes', row, ctx.workerId);
        for (const row of existing.filter((b) => !wanted.includes(b.code))) {
          const gone = { ...row, deletedAt: now, updatedAt: now, version: row.version + 1 };
          await db.barcodes.put(gone);
          await enqueue(db, 'barcodes', gone, ctx.workerId, {
            changedFields: ['deletedAt'],
            baseVersion: row.version,
          });
        }
      }

      if (input.packUnit !== undefined) {
        const existing = (await db.productUnits.where('productId').equals(productId).toArray()).find(
          (u) => !u.deletedAt,
        );
        if (input.packUnit === null && existing) {
          const gone = { ...existing, deletedAt: now, updatedAt: now, version: existing.version + 1 };
          await db.productUnits.put(gone);
          await enqueue(db, 'productUnits', gone, ctx.workerId, {
            changedFields: ['deletedAt'],
            baseVersion: existing.version,
          });
        } else if (unit?.success) {
          const unitFields = { name: unit.data.name, factor: unit.data.factorMilli, price: unit.data.price };
          await upsertRow<ProductUnit>(
            ctx,
            'productUnits',
            db.productUnits,
            { id: existing?.id, fields: unitFields },
            unitFields,
            () => ({
              ...newCommon(ctx),
              productId,
              name: '',
              factor: 1000,
              price: null,
              isDefaultSale: false,
              isDefaultPurchase: false,
            }),
          );
        }
      }

      await patchIndex(db, productId, before);
      return { ok: true, id: productId, version: saved.version };
    },
  );
}
