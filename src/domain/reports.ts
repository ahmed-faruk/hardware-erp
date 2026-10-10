import { formatMoney, formatQty } from './money';

/** A report ready to show, print and export: headers, formatted rows and an optional totals row. */
export interface ReportTable {
  title: string;
  headers: string[];
  rows: string[][];
  totals?: string[];
  /** small print under the table (e.g. how the profit is calculated) */
  note?: string;
}

export interface ReportLabels {
  [key: string]: string;
}

const m = (p: unknown): string => formatMoney(Number(p));

interface SalesData {
  days: { day: string; invoices: number; gross: number; returns: number; net: number }[];
  total: { invoices: number; gross: number; returns: number; net: number };
  by_method: { method: string; amount: number }[];
  by_worker: { worker: string; invoices: number; gross: number }[];
  legacy_invoices: number;
}

/** Daily sales: one row per Cairo day, then the payment-method and cashier splits as extra tables. */
export function salesTables(d: SalesData, t: ReportLabels, methodName: (k: string) => string): ReportTable[] {
  return [
    {
      title: t.title ?? '',
      headers: [t.day!, t.invoices!, t.gross!, t.returns!, t.net!],
      rows: d.days.map((r) => [r.day, String(r.invoices), m(r.gross), m(r.returns), m(r.net)]),
      totals: [t.total!, String(d.total.invoices), m(d.total.gross), m(d.total.returns), m(d.total.net)],
      note: d.legacy_invoices > 0 ? `${t.legacy}: ${d.legacy_invoices}` : undefined,
    },
    {
      title: t.byMethod!,
      headers: [t.method!, t.amount!],
      rows: d.by_method.map((r) => [methodName(r.method), m(r.amount)]),
    },
    {
      title: t.byWorker!,
      headers: [t.worker!, t.invoices!, t.gross!],
      rows: d.by_worker.map((r) => [r.worker, String(r.invoices), m(r.gross)]),
    },
  ];
}

interface ProfitData {
  days: { day: string; revenue: number; cost: number; profit: number }[];
  total: { revenue: number; cost: number; profit: number };
}

export function profitTable(d: ProfitData, t: ReportLabels): ReportTable {
  return {
    title: t.title ?? '',
    headers: [t.day!, t.revenue!, t.cost!, t.profit!],
    rows: d.days.map((r) => [r.day, m(r.revenue), m(r.cost), m(r.profit)]),
    totals: [t.total!, m(d.total.revenue), m(d.total.cost), m(d.total.profit)],
    note: t.profitNote,
  };
}

interface ExceptionsData {
  voids: { number: string; at: string; reason: string; worker: string }[];
  reprints: number;
  no_sales: { at: string; worker: string; approved_by: string }[];
  discounts: { lines: number; amount: number };
  stock_adjustments: { number: string; at: string; reason: string; approved_by: string }[];
  shift_variances: { number: string; variance: number; worker: string; approved_by: string }[];
  negative_stock: number;
  price_overrides: number;
  discount_overrides: number;
  pin_failures: number;
  cart_removals: number;
  settings_changes: { key: string; at: string; worker: string }[];
  clock_warnings: { device: string; at: string; skew_ms: number }[];
  cash_adjustments?: { number: string; at: string; account: string; amount: number; reason: string }[];
}

export function exceptionsTables(
  d: ExceptionsData,
  t: ReportLabels,
  time: (iso: string) => string,
  reasonName: (r: string) => string,
): ReportTable[] {
  return [
    {
      title: t.title ?? '',
      headers: [t.reason!, t.count!],
      rows: [
        [t.voids!, String(d.voids.length)],
        [t.reprints!, String(d.reprints)],
        [t.noSales!, String(d.no_sales.length)],
        [t.discounts!, `${d.discounts.lines} (${m(d.discounts.amount)})`],
        [t.adjustments!, String(d.stock_adjustments.length)],
        [t.shiftVariances!, String(d.shift_variances.length)],
        [t.negativeStock!, String(d.negative_stock)],
        [t.priceOverrides!, String(d.price_overrides)],
        [t.discountOverrides!, String(d.discount_overrides)],
        [t.pinFailures!, String(d.pin_failures)],
        [t.cartRemovals!, String(d.cart_removals)],
        [t.clockWarnings!, String(d.clock_warnings.length)],
      ],
    },
    {
      title: t.voids!,
      headers: [t.number!, t.time!, t.reason!, t.worker!],
      rows: d.voids.map((r) => [r.number, time(r.at), reasonName(r.reason), r.worker]),
    },
    {
      title: t.noSales!,
      headers: [t.time!, t.worker!, t.approvedBy!],
      rows: d.no_sales.map((r) => [time(r.at), r.worker, r.approved_by]),
    },
    {
      title: t.adjustments!,
      headers: [t.number!, t.time!, t.reason!, t.approvedBy!],
      rows: d.stock_adjustments.map((r) => [r.number, time(r.at), reasonName(r.reason), r.approved_by]),
    },
    {
      title: t.settingsChanges!,
      headers: [t.number!, t.time!, t.worker!],
      rows: d.settings_changes.map((r) => [r.key, time(r.at), r.worker]),
    },
    {
      title: t.cashAdjustments!,
      headers: [t.number!, t.time!, t.account!, t.amount!],
      rows: (d.cash_adjustments ?? []).map((r) => [r.number, time(r.at), r.account, m(r.amount)]),
    },
    {
      title: t.shiftVariances!,
      headers: [t.number!, t.worker!, t.profit!, t.approvedBy!],
      rows: d.shift_variances.map((r) => [r.number, r.worker, m(r.variance), r.approved_by]),
    },
  ];
}

interface DeviceRow {
  name: string;
  prefix: string;
  last_seen_at: string | null;
  app_version: string | null;
  revoked: boolean;
  open_shift: boolean;
  errors_24h: number;
}
type DevicesData = DeviceRow[];

export function devicesTable(d: DevicesData, t: ReportLabels, time: (iso: string) => string): ReportTable {
  return {
    title: t.title ?? '',
    headers: [t.device!, t.lastSeen!, t.version!, t.openShift!, t.errors!],
    rows: d.map((r) => [
      `${r.name} (${r.prefix})${r.revoked ? ` — ${t.revoked}` : ''}`,
      r.last_seen_at ? time(r.last_seen_at) : t.never!,
      r.app_version ?? '',
      r.open_shift ? t.yes! : '',
      String(r.errors_24h),
    ]),
  };
}

export interface StockRow {
  name: string;
  sku: string | null;
  qtyMilli: number;
  unitCost: number;
  reorderLevel: number;
}

/** Stock on hand from the device: quantity, cost and value; rows under their reorder level are marked. */
export function stockTable(rows: StockRow[], t: ReportLabels): ReportTable {
  const value = (r: StockRow): number => Math.round((r.qtyMilli * r.unitCost) / 1000);
  return {
    title: t.title ?? '',
    headers: [t.product!, t.qty!, t.cost!, t.value!, t.low!],
    rows: rows.map((r) => [
      r.name,
      formatQty(r.qtyMilli),
      m(r.unitCost),
      m(value(r)),
      r.qtyMilli < r.reorderLevel ? t.low! : '',
    ]),
    totals: [t.total!, '', '', m(rows.reduce((a, r) => a + value(r), 0)), ''],
    note: t.stockNote,
  };
}
