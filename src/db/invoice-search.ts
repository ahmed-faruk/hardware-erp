import {
  cairoDayStartIso,
  EMPTY_FILTER,
  matchesInvoice,
  type InvoiceFilter,
  type InvoiceRow,
} from '@/domain/invoice-filter';

import type { HanafyDB } from './schema';
import { searchProducts } from './search';
import { findByBarcode } from './lookup';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const cairoDayOf = (iso: string): string => DAY_FORMAT.format(new Date(iso));
const nextDay = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** What the product box means: the ids of the products matching a name or a barcode (null = nothing typed). */
export async function resolveProductIds(db: HanafyDB, text: string): Promise<string[] | null> {
  const clean = text.trim();
  if (!clean) return null;
  const byCode = await findByBarcode(db, clean);
  const named = await searchProducts(db, clean, { includeInactive: true, limit: 200 });
  const ids = new Set(named.map((p) => p.id));
  if (byCode) ids.add(byCode.product.id);
  // the search index forgets archived products and may lag behind: look at every product's name and code too
  const lower = clean.toLowerCase();
  for (const p of await db.products
    .filter((x) => x.name.toLowerCase().includes(lower) || (x.sku ?? '').toLowerCase() === lower)
    .toArray())
    ids.add(p.id);
  return [...ids];
}

export interface SearchResult {
  rows: InvoiceRow[];
  /** how many matched in all (rows is cut to `limit`) */
  matched: number;
}

/** The invoices of this device that the filter keeps, newest first. Cheap fields first, the payments and lines only for what is left. */
export async function searchSalesInvoices(
  db: HanafyDB,
  f: InvoiceFilter,
  limit = 100,
): Promise<SearchResult> {
  const lo = f.from ? cairoDayStartIso(f.from) : '';
  const hi = f.to ? cairoDayStartIso(nextDay(f.to)) : '';
  let list = await db.salesInvoices.toArray();
  if (lo) list = list.filter((i) => i.issuedAt >= lo);
  if (hi) list = list.filter((i) => i.issuedAt < hi);
  list.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const customers = new Map((await db.customers.toArray()).map((c) => [c.id, c.name]));
  const base = (i: (typeof list)[number]): InvoiceRow => ({
    id: i.id,
    number: i.number,
    day: cairoDayOf(i.issuedAt),
    partyName: (i.customerId && customers.get(i.customerId)) || '',
    status: i.status,
    hasReturn: false,
    methods: [],
    total: i.total,
    productIds: [],
    workerId: i.workerId,
    deviceId: i.deviceId,
    shiftId: i.shiftId,
  });
  // stage 1: what is on the invoice itself
  const cheap: InvoiceFilter = {
    ...f,
    status: f.status === 'returned' ? '' : f.status,
    method: '',
    productIds: null,
  };
  const survivors = list.filter((i) => matchesInvoice(base(i), cheap));
  const needsMore = f.status === 'returned' || f.method !== '' || f.productIds !== null;
  const ids = survivors.map((i) => i.id);
  const payments =
    needsMore || survivors.length <= 500
      ? await db.payments
          .where('[documentType+documentId]')
          .anyOf(ids.map((id) => ['sales_invoice', id]))
          .toArray()
      : [];
  // the «has a return» mark is shown on every row, so returns are looked up unless the list is huge and nothing asks for them
  const wantReturns = f.status === 'returned' || survivors.length <= 2000;
  const returns = wantReturns ? await db.salesReturns.where('originalInvoiceId').anyOf(ids).toArray() : [];
  const lines =
    f.productIds !== null ? await db.salesInvoiceLines.where('invoiceId').anyOf(ids).toArray() : [];
  const methodsOf = new Map<string, string[]>();
  for (const p of payments) methodsOf.set(p.documentId, [...(methodsOf.get(p.documentId) ?? []), p.method]);
  const returned = new Set(
    returns.filter((r) => r.status === 'posted').map((r) => r.originalInvoiceId as string),
  );
  const productsOf = new Map<string, string[]>();
  for (const l of lines)
    if (l.productId) productsOf.set(l.invoiceId, [...(productsOf.get(l.invoiceId) ?? []), l.productId]);
  const full = survivors
    .map((i) => ({
      ...base(i),
      methods: methodsOf.get(i.id) ?? [],
      hasReturn: returned.has(i.id),
      productIds: productsOf.get(i.id) ?? [],
    }))
    .filter((r) => matchesInvoice(r, f));
  return { rows: full.slice(0, limit), matched: full.length };
}

/** The same for purchase invoices (no device or shift on them). */
export async function searchPurchaseInvoices(
  db: HanafyDB,
  f: InvoiceFilter,
  limit = 100,
): Promise<SearchResult> {
  const lo = f.from ? cairoDayStartIso(f.from) : '';
  const hi = f.to ? cairoDayStartIso(nextDay(f.to)) : '';
  let list = await db.purchaseInvoices.toArray();
  if (lo) list = list.filter((i) => i.issuedAt >= lo);
  if (hi) list = list.filter((i) => i.issuedAt < hi);
  list.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const suppliers = new Map((await db.suppliers.toArray()).map((s) => [s.id, s.name]));
  const base = (i: (typeof list)[number]): InvoiceRow => ({
    id: i.id,
    number: i.number,
    day: cairoDayOf(i.issuedAt),
    partyName: suppliers.get(i.supplierId as string) ?? '',
    status: i.status === 'voided' ? 'voided' : 'posted',
    hasReturn: false,
    methods: [],
    total: i.total as number,
    productIds: [],
    workerId: i.workerId,
    deviceId: i.deviceId,
    shiftId: null,
  });
  const cheap: InvoiceFilter = {
    ...f,
    status: f.status === 'returned' ? '' : f.status,
    method: '',
    productIds: null,
  };
  const survivors = list.filter((i) => matchesInvoice(base(i), cheap));
  const ids = survivors.map((i) => i.id);
  const payments = await db.payments
    .where('[documentType+documentId]')
    .anyOf(ids.map((id) => ['purchase_invoice', id]))
    .toArray();
  const wantReturns = f.status === 'returned' || survivors.length <= 2000;
  const idSet = new Set(ids);
  const returns = wantReturns
    ? await db.purchaseReturns.filter((r) => idSet.has(r.originalInvoiceId as string)).toArray()
    : [];
  const lines =
    f.productIds !== null ? await db.purchaseInvoiceLines.where('invoiceId').anyOf(ids).toArray() : [];
  const methodsOf = new Map<string, string[]>();
  for (const p of payments) methodsOf.set(p.documentId, [...(methodsOf.get(p.documentId) ?? []), p.method]);
  const returned = new Set(
    returns.filter((r) => r.status === 'posted').map((r) => r.originalInvoiceId as string),
  );
  const productsOf = new Map<string, string[]>();
  for (const l of lines) {
    const pid = l.productId as string | null;
    if (pid) productsOf.set(l.invoiceId as string, [...(productsOf.get(l.invoiceId as string) ?? []), pid]);
  }
  const full = survivors
    .map((i) => ({
      ...base(i),
      methods: methodsOf.get(i.id) ?? [],
      hasReturn: returned.has(i.id),
      productIds: productsOf.get(i.id) ?? [],
    }))
    .filter((r) => matchesInvoice(r, f));
  return { rows: full.slice(0, limit), matched: full.length };
}

/** Every invoice of today (Cairo day) made on this device, from any shift, newest first. */
export async function todaysInvoices(db: HanafyDB, deviceId: string, now = new Date()) {
  const day = cairoDayOf(now.toISOString());
  const start = cairoDayStartIso(day);
  const end = cairoDayStartIso(nextDay(day));
  return (await db.salesInvoices.where('issuedAt').between(start, end, true, false).toArray())
    .filter((i) => i.deviceId === deviceId)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export { EMPTY_FILTER };
