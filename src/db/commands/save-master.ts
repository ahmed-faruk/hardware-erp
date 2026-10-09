import { can } from '@/domain/permissions';
import { err, type Err } from '@/domain/result';
import { customerFieldsSchema, productFieldsSchema } from '@/domain/schemas';

import { newCommon, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import type { Customer, Product } from '../types';

export interface SaveInput {
  id?: string;
  fields: unknown;
  /** version the screen was showing; a mismatch means someone changed the record meanwhile */
  baseVersion?: number;
}
export type SaveResult = { ok: true; id: string; version: number } | Err;

/** Master-data edit: sends only the changed fields so the server can merge field by field. */
async function saveMaster<R extends Product | Customer>(
  ctx: DeviceContext,
  table: 'products' | 'customers',
  input: SaveInput,
  fields: Partial<R>,
  create: () => R,
): Promise<SaveResult> {
  const { db } = ctx;
  const store = db[table] as unknown as typeof db.products;
  return db.transaction('rw', [store, db.outbox, db.syncState], async (): Promise<SaveResult> => {
    const existing = input.id ? await store.get(input.id) : undefined;
    if (!existing) {
      const record = { ...create(), ...fields } as R;
      await store.add(record as Product);
      await enqueue(db, table, record, ctx.workerId);
      return { ok: true, id: record.id, version: record.version };
    }
    if (input.baseVersion !== undefined && input.baseVersion !== existing.version) {
      return err('E_CONFLICT', 'السجل اتغيّر، افتحه تاني');
    }
    const changed = Object.keys(fields).filter(
      (k) => (fields as Record<string, unknown>)[k] !== (existing as unknown as Record<string, unknown>)[k],
    );
    if (changed.length === 0) return { ok: true, id: existing.id, version: existing.version };
    const updated = { ...existing, ...fields, updatedAt: nowIso(), version: existing.version + 1 };
    await store.put(updated as Product);
    await enqueue(db, table, updated, ctx.workerId, {
      changedFields: changed,
      baseVersion: existing.version,
    });
    return { ok: true, id: updated.id, version: updated.version };
  });
}

export async function saveProduct(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = productFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات الصنف غير صحيحة');
  if (can(ctx.role, 'editProductData') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (('price' in parsed.data || 'unitCost' in parsed.data) && can(ctx.role, 'editPrices') !== 'yes') {
    return err('E_FORBIDDEN', 'الأسعار للمدير فقط');
  }
  const f = parsed.data as Partial<Product>;
  return saveMaster<Product>(ctx, 'products', input, f, () => ({
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
}

export async function saveCustomer(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = customerFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات العميل غير صحيحة');
  if (can(ctx.role, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const f = parsed.data as Partial<Customer>;
  return saveMaster<Customer>(ctx, 'customers', input, f, () => ({
    ...newCommon(ctx),
    name: '',
    phone: null,
    address: null,
    company: null,
    notes: null,
    creditLimit: 0,
    defaultDiscountBp: 0,
    photoPath: null,
    active: true,
    legacyPersonId: null,
  }));
}
