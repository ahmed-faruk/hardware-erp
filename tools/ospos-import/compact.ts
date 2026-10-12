import type { Row, TableName } from './types.ts';

/**
 * The imported OpenSourcePOS history in its compact form (supabase/migrations/20261012170000_legacy_compact.sql): integer ids (the OpenSourcePOS
 * ids), no UUIDs, no sync columns. Products, customers, suppliers and workers are linked through their legacy ids. The wide rows built by the
 * transform stay in memory for the balances and the validation; only these compact rows go to the database.
 */
export interface CompactTables {
  legacy_sales: Row[];
  legacy_sale_lines: Row[];
  legacy_purchases: Row[];
  legacy_purchase_lines: Row[];
}
export const COMPACT_ORDER = [
  'legacy_sales',
  'legacy_sale_lines',
  'legacy_purchases',
  'legacy_purchase_lines',
] as const;
export type CompactName = (typeof COMPACT_ORDER)[number];

/** Wide tables that are replaced by the compact ones (every row of them is imported history). */
export const WIDE_LEGACY: TableName[] = [
  'sales_invoices',
  'sales_returns',
  'sales_invoice_lines',
  'sales_return_lines',
  'purchase_invoices',
  'purchase_returns',
  'purchase_invoice_lines',
  'purchase_return_lines',
  'payments',
];

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const cairoDay = (iso: unknown): string => CAIRO_DAY.format(new Date(String(iso)));
const num = (v: unknown): number => Number(v ?? 0);
const legacyOf = (row: Row): number => Number((row.legacy as { ospos_id: number }).ospos_id);

interface Split {
  cash: number;
  card: number;
  credit: number;
  other: number;
}
const emptySplit = (): Split => ({ cash: 0, card: 0, credit: 0, other: 0 });

export function compactLegacy(t: Record<TableName, Row[]>): CompactTables {
  const productLegacy = new Map(t.products.map((p) => [String(p.id), p.legacy_item_id as number | null]));
  const customerLegacy = new Map(t.customers.map((c) => [String(c.id), c.legacy_person_id as number | null]));
  const supplierLegacy = new Map(t.suppliers.map((s) => [String(s.id), s.legacy_person_id as number | null]));
  const workerLegacy = new Map(t.workers.map((w) => [String(w.id), w.legacy_employee_id as number | null]));

  const payments = new Map<string, Split>();
  for (const p of t.payments) {
    const key = String(p.document_id);
    const s = payments.get(key) ?? emptySplit();
    const m = String(p.method);
    s[m === 'cash' || m === 'card' || m === 'credit' ? m : 'other'] += num(p.amount);
    payments.set(key, s);
  }

  const out: CompactTables = {
    legacy_sales: [],
    legacy_sale_lines: [],
    legacy_purchases: [],
    legacy_purchase_lines: [],
  };
  const company = (t.companies[0] as Row).id as string;
  const saleOf = new Map<string, number>(); // document uuid -> OpenSourcePOS id
  for (const [rows, kind] of [
    [t.sales_invoices, 0],
    [t.sales_returns, 1],
  ] as const) {
    for (const d of rows) {
      const id = legacyOf(d);
      saleOf.set(String(d.id), id);
      const pay = payments.get(String(d.id)) ?? emptySplit();
      out.legacy_sales.push({
        company_id: company,
        id,
        kind,
        day: cairoDay(d.issued_at),
        customer_id: d.customer_id ? (customerLegacy.get(String(d.customer_id)) ?? null) : null,
        employee_id: d.worker_id ? (workerLegacy.get(String(d.worker_id)) ?? null) : null,
        total: num(d.total),
        ...pay,
      });
    }
  }
  for (const l of t.sales_invoice_lines) {
    const product = l.product_id ? (productLegacy.get(String(l.product_id)) ?? null) : null;
    const qty = Math.round((num(l.qty) * num(l.unit_factor)) / 1000);
    out.legacy_sale_lines.push({
      sale_id: saleOf.get(String(l.invoice_id)) as number,
      line_no: num(l.line_no),
      product_id: product,
      text: l.product_id ? null : ((l.legacy_text as string | null) ?? null),
      qty,
      net: num(l.net_amount) - num(l.alloc_discount),
      cost: Math.round((num(l.unit_cost) * num(l.qty) * num(l.unit_factor)) / 1_000_000),
    });
  }
  const returnLine = new Map<string, number>();
  for (const l of t.sales_return_lines) {
    const key = String(l.return_id);
    const n = (returnLine.get(key) ?? 0) + 1;
    returnLine.set(key, n);
    out.legacy_sale_lines.push({
      sale_id: saleOf.get(key) as number,
      line_no: n,
      product_id: l.product_id ? (productLegacy.get(String(l.product_id)) ?? null) : null,
      text: null,
      qty: num(l.qty),
      net: num(l.net_amount),
      cost: Math.round((num(l.unit_cost) * num(l.qty)) / 1000),
    });
  }

  const purchaseOf = new Map<string, number>();
  for (const [rows, kind] of [
    [t.purchase_invoices, 0],
    [t.purchase_returns, 1],
  ] as const) {
    for (const d of rows) {
      const id = legacyOf(d);
      purchaseOf.set(String(d.id), id);
      const pay = payments.get(String(d.id)) ?? emptySplit();
      out.legacy_purchases.push({
        company_id: company,
        id,
        kind,
        day: cairoDay(d.issued_at),
        supplier_id: supplierLegacy.get(String(d.supplier_id)) ?? null,
        total: num(d.total),
        cash: pay.cash,
        credit: pay.credit,
        other: pay.card + pay.other,
      });
    }
  }
  for (const [rows, key] of [
    [t.purchase_invoice_lines, 'invoice_id'],
    [t.purchase_return_lines, 'return_id'],
  ] as const) {
    for (const l of rows) {
      out.legacy_purchase_lines.push({
        purchase_id: purchaseOf.get(String(l[key])) as number,
        line_no: num(l.line_no),
        product_id: l.product_id ? (productLegacy.get(String(l.product_id)) ?? null) : null,
        text: l.product_id ? null : ((l.legacy_text as string | null) ?? null),
        qty: Math.round((num(l.qty) * num(l.unit_factor)) / 1000),
        net: num(l.net_amount),
      });
    }
  }
  return out;
}
