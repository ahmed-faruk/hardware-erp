import { err, type Err } from '@/domain/result';
import {
  categoryFieldsSchema,
  customerFieldsSchema,
  permissionGroupFieldsSchema,
  supplierFieldsSchema,
  workerFieldsSchema,
} from '@/domain/schemas';

import { newCommon, type DeviceContext, canCtx } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import type { HanafyDB } from '../schema';
import type { Category, Customer, PermissionGroup, Supplier, Worker } from '../types';

export interface SaveInput {
  id?: string;
  fields: unknown;
  /** version the screen was showing; a mismatch means someone changed the record meanwhile */
  baseVersion?: number;
}
export type SaveResult = { ok: true; id: string; version: number } | Err;

interface Row {
  id: string;
  version: number;
}
type Store<R extends Row> = {
  get(id: string): Promise<R | undefined>;
  add(row: R): Promise<unknown>;
  put(row: R): Promise<unknown>;
};
export type Saved<R extends Row> =
  { ok: true; id: string; version: number; row: R; created: boolean; changed: string[] } | Err;

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

/**
 * Master-data upsert INSIDE the caller's transaction: sends only the changed fields so the server can merge field by field.
 * `table` is the Dexie table name (also the outbox table name).
 */
export async function upsertRow<R extends Row>(
  ctx: DeviceContext,
  table: keyof HanafyDB & string,
  store: Store<R>,
  input: SaveInput,
  fields: Record<string, unknown>,
  create: () => R,
): Promise<Saved<R>> {
  const existing = input.id ? await store.get(input.id) : undefined;
  if (!existing) {
    const row = { ...create(), ...fields } as R;
    await store.add(row);
    await enqueue(ctx.db, table as 'products', row, ctx.workerId);
    return { ok: true, id: row.id, version: row.version, row, created: true, changed: Object.keys(fields) };
  }
  if (input.baseVersion !== undefined && input.baseVersion !== existing.version) {
    return err('E_CONFLICT', 'السجل اتغيّر، افتحه تاني');
  }
  const changed = Object.keys(fields).filter(
    (k) => !sameValue(fields[k], (existing as unknown as Record<string, unknown>)[k]),
  );
  if (changed.length === 0)
    return { ok: true, id: existing.id, version: existing.version, row: existing, created: false, changed };
  const row = { ...existing, ...fields, updatedAt: nowIso(), version: existing.version + 1 } as R;
  await store.put(row);
  await enqueue(ctx.db, table as 'products', row, ctx.workerId, {
    changedFields: changed,
    baseVersion: existing.version,
  });
  return { ok: true, id: row.id, version: row.version, row, created: false, changed };
}

const out = (s: Saved<Row>): SaveResult => (s.ok ? { ok: true, id: s.id, version: s.version } : s);

export async function saveCustomer(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = customerFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات العميل غير صحيحة');
  if (canCtx(ctx, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.customers, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Customer>(ctx, 'customers', db.customers, input, parsed.data, () => ({
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
      })),
    ),
  );
}

export async function saveSupplier(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = supplierFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المورد غير صحيحة');
  if (canCtx(ctx, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.suppliers, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Supplier>(ctx, 'suppliers', db.suppliers, input, parsed.data, () => ({
        ...newCommon(ctx),
        name: '',
        contactName: null,
        phone: null,
        address: null,
        notes: null,
        isExpenseSupplier: false,
        active: true,
        legacyPersonId: null,
      })),
    ),
  );
}

export async function saveCategory(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = categoryFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات التصنيف غير صحيحة');
  if (canCtx(ctx, 'editProductData') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.categories, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Category>(ctx, 'categories', db.categories, input, parsed.data, () => ({
        ...newCommon(ctx),
        parentId: null,
        name: '',
        colorToken: null,
        icon: null,
        sort: 0,
      })),
    ),
  );
}

/** Workers: managers only. Logins (username and password) are made on the server by `set_worker_login`, never here. */
export async function saveWorker(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = workerFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات العامل غير صحيحة');
  if (canCtx(ctx, 'manageUsers') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const fields: Record<string, unknown> = { ...parsed.data };
  if (!input.id && (!parsed.data.name || !parsed.data.role))
    return err('E_VALIDATION', 'العامل الجديد محتاج اسم ووظيفة');
  const { db } = ctx;
  return db.transaction('rw', [db.workers, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Worker>(ctx, 'workers', db.workers, input, fields, () => ({
        ...newCommon(ctx),
        name: '',
        role: 'cashier',
        pinHash: null,
        pinSalt: null,
        username: null,
        photoPath: null,
        active: true,
        legacyEmployeeId: null,
      })),
    ),
  );
}

/** Permission groups: who may do what. Only a worker with `manageGroups` (a manager always has it) can create, change or delete one. */
export async function savePermissionGroup(ctx: DeviceContext, input: SaveInput): Promise<SaveResult> {
  const parsed = permissionGroupFieldsSchema.safeParse(input.fields);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المجموعة غير صحيحة');
  if (canCtx(ctx, 'manageGroups') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (!input.id && !parsed.data.name) return err('E_VALIDATION', 'المجموعة محتاجة اسم');
  const { db } = ctx;
  return db.transaction('rw', [db.permissionGroups, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<PermissionGroup>(
        ctx,
        'permissionGroups',
        db.permissionGroups,
        input,
        parsed.data,
        () => ({
          ...newCommon(ctx),
          name: '',
          permissions: {},
        }),
      ),
    ),
  );
}

/** A cashier adds a customer at the counter: name and phone only, credit limit 0 and no discount (the server enforces the same). */
export async function addCustomer(
  ctx: DeviceContext,
  input: { name: string; phone?: string | null },
): Promise<SaveResult> {
  const parsed = customerFieldsSchema
    .pick({ name: true, phone: true })
    .safeParse({ name: input.name, phone: input.phone ?? null });
  if (!parsed.success || !parsed.data.name) return err('E_VALIDATION', 'بيانات العميل غير صحيحة');
  if (canCtx(ctx, 'addCustomer') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.customers, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Customer>(
        ctx,
        'customers',
        db.customers,
        { fields: {} },
        { name: parsed.data.name, phone: parsed.data.phone ?? null },
        () => ({
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
        }),
      ),
    ),
  );
}

/** A supplier added from the purchase screen: name and phone only (permission addSupplier; the server lets such a worker create, not edit). */
export async function addSupplier(
  ctx: DeviceContext,
  input: { name: string; phone?: string | null },
): Promise<SaveResult> {
  const parsed = supplierFieldsSchema
    .pick({ name: true, phone: true })
    .safeParse({ name: input.name, phone: input.phone ?? null });
  if (!parsed.success || !parsed.data.name) return err('E_VALIDATION', 'بيانات المورد غير صحيحة');
  if (canCtx(ctx, 'addSupplier') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.suppliers, db.outbox, db.syncState], async () =>
    out(
      await upsertRow<Supplier>(
        ctx,
        'suppliers',
        db.suppliers,
        { fields: {} },
        { name: parsed.data.name, phone: parsed.data.phone ?? null },
        () => ({
          ...newCommon(ctx),
          name: '',
          contactName: null,
          phone: null,
          address: null,
          notes: null,
          isExpenseSupplier: false,
          active: true,
          legacyPersonId: null,
        }),
      ),
    ),
  );
}
