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

interface PurchasesTotals {
  invoices: number;
  total: number;
  safe: number;
  owner: number;
  other: number;
  credit: number;
  returns: number;
  later_owner: number;
  later_other: number;
}
interface PurchasesData {
  total: PurchasesTotals;
  by_supplier: (PurchasesTotals & { supplier: string })[];
  legacy_invoices: number;
}

/** Purchases: where the money came from (safe / the owner's pocket / bank / still owed), in total and per supplier. */
export function purchasesTables(d: PurchasesData, t: ReportLabels): ReportTable[] {
  const x = d.total;
  return [
    {
      title: t.title ?? '',
      headers: [t.item!, t.amount!],
      rows: [
        [t.invoices!, String(x.invoices)],
        [t.purchTotal!, m(x.total)],
        [t.fromSafe!, m(x.safe)],
        [t.fromOwner!, m(x.owner)],
        [t.otherPay!, m(x.other)],
        [t.onCredit!, m(x.credit)],
        [t.returns!, m(x.returns)],
        [t.laterOwner!, m(x.later_owner)],
        [t.laterOther!, m(x.later_other)],
      ],
      note: d.legacy_invoices > 0 ? `${t.legacy}: ${d.legacy_invoices}` : undefined,
    },
    {
      title: t.bySupplier!,
      headers: [t.supplier!, t.purchTotal!, t.fromSafe!, t.fromOwner!, t.onCredit!, t.returns!],
      rows: d.by_supplier.map((r) => [
        r.supplier,
        m(r.total),
        m(r.safe),
        m(r.owner),
        m(r.credit),
        m(r.returns),
      ]),
      totals: [t.total!, m(x.total), m(x.safe), m(x.owner), m(x.credit), m(x.returns)],
    },
  ];
}

export interface SupplierDetailData {
  suppliers: {
    supplier_id: string;
    name: string;
    invoices: number;
    total: number;
    list: { number: string; day: string; total: number }[];
    top: { name: string; net: number }[];
  }[];
}

/** One table per supplier: its invoices (number, day, amount) with the count in the title and the top products in the note. */
export function supplierDetailTables(d: SupplierDetailData, t: ReportLabels): ReportTable[] {
  return d.suppliers.map((s) => ({
    title: `${s.name} · ${t.invoices}: ${s.invoices}`,
    headers: [t.invoiceNumber!, t.day!, t.amount!],
    rows: s.list.map((r) => [r.number, r.day, m(r.total)]),
    totals: [t.total!, '', m(s.total)],
    note: s.top.length
      ? `${t.topProducts}: ${s.top.map((x) => `${x.name} (${m(x.net)})`).join(' · ')}`
      : undefined,
  }));
}

export interface SafeData {
  in: { key: string; amount: number }[];
  out: { key: string; amount: number }[];
  adjust: { key: string; amount: number }[];
  total_in: number;
  total_out: number;
  adjust_total: number;
  net: number;
  owner_paid: number;
  legacy_count: number;
}

/** «الخزنة»: the money that came in, the money that went out, and the summary (adjustments carry their sign). */
export function safeTables(d: SafeData, t: ReportLabels, keyName: (k: string) => string): ReportTable[] {
  const lines = (rows: { key: string; amount: number }[]): string[][] =>
    rows.map((r) => [keyName(r.key), m(r.amount)]);
  const notes = [
    d.owner_paid > 0 ? `${t.safeOwnerNote}: ${m(d.owner_paid)}` : '',
    d.legacy_count > 0 ? `${t.legacy}: ${d.legacy_count}` : '',
  ].filter(Boolean);
  return [
    {
      title: t.safeIn!,
      headers: [t.item!, t.amount!],
      rows: lines(d.in),
      totals: [t.total!, m(d.total_in)],
    },
    {
      title: t.safeOut!,
      headers: [t.item!, t.amount!],
      rows: lines(d.out),
      totals: [t.total!, m(d.total_out)],
    },
    {
      title: t.safeSummary!,
      headers: [t.item!, t.amount!],
      rows: [
        [t.safeIn!, m(d.total_in)],
        [t.safeOut!, m(d.total_out)],
        ...(d.adjust.length > 0 ? [[t.safeAdjust!, m(d.adjust_total)]] : []),
        [t.safeNet!, m(d.net)],
      ],
      note: notes.length > 0 ? notes.join(' · ') : undefined,
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
  voids: {
    number: string;
    at: string;
    reason: string;
    worker: string;
    target_type?: string;
    target_number?: string;
  }[];
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
      headers: [t.number!, t.voidKind!, t.voidTarget!, t.time!, t.reason!, t.worker!],
      rows: d.voids.map((r) => [
        r.number,
        (r.target_type === 'sales_return'
          ? t.voidSalesReturn
          : r.target_type === 'purchase_invoice'
            ? t.voidPurchaseInvoice
            : r.target_type === 'expense'
              ? t.voidExpense
              : r.target_type === 'payroll_entry'
                ? t.voidPayrollEntry
                : t.voidSalesInvoice) ?? '',
        r.target_number ?? '—',
        time(r.at),
        reasonName(r.reason),
        r.worker,
      ]),
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

export interface HistoryRow {
  at: string;
  doc_type: string;
  number: string | null;
  party: string | null;
  in_qty: number;
  out_qty: number;
  balance: number;
  legacy: boolean;
}

/** One product's movements: what came in, what went out and the balance after each row; imported rows say «قديم». */
export function historyTable(
  rows: HistoryRow[],
  t: ReportLabels,
  time: (iso: string) => string,
  docName: (docType: string) => string,
): ReportTable {
  return {
    title: t.title ?? '',
    headers: [t.time!, t.document!, t.number!, t.party!, t.qtyIn!, t.qtyOut!, t.balance!],
    rows: rows.map((r) => [
      time(r.at),
      `${docName(r.doc_type)}${r.legacy ? ` (${t.legacyTag})` : ''}`,
      r.number ?? '',
      r.party ?? '',
      r.in_qty ? formatQty(r.in_qty) : '',
      r.out_qty ? formatQty(r.out_qty) : '',
      formatQty(r.balance),
    ]),
    note: t.historyNote,
  };
}

interface ExpensesData {
  total: { count: number; amount: number };
  by_category: { category: string; count: number; amount: number }[];
  by_account: { account: string | null; count: number; amount: number }[];
  by_day: { day: string; count: number; amount: number }[];
  list: {
    number: string;
    at: string;
    category: string;
    account: string | null;
    amount: number;
    legacy: boolean;
    note: string | null;
  }[];
  legacy_count: number;
  /** net salaries paid in the period (advances are not expenses) */
  payroll?: { count: number; amount: number };
}

/** Whole percent of `part` in `whole`, rounded half up; 0 when there is nothing. */
export const percentOf = (part: number, whole: number): number =>
  whole > 0 ? Math.floor((part * 100 + whole / 2) / whole) : 0;

/** Expenses: by category (with each one's share), by cash account, by day and the list. */
export function expensesTables(
  d: ExpensesData,
  t: ReportLabels,
  time: (iso: string) => string,
): ReportTable[] {
  const all = d.total.amount;
  return [
    {
      title: t.title ?? '',
      headers: [t.category!, t.count!, t.amount!, t.share!],
      rows: d.by_category.map((r) => [
        r.category || t.noCategory!,
        String(r.count),
        m(r.amount),
        `${percentOf(r.amount, all)}%`,
      ]),
      totals: [t.total!, String(d.total.count), m(all), all > 0 ? '100%' : '0%'],
      note: d.legacy_count > 0 ? `${t.legacy}: ${d.legacy_count}` : undefined,
    },
    ...(d.payroll && d.payroll.amount > 0
      ? [
          {
            title: t.payrollTitle!,
            headers: [t.count!, t.amount!],
            rows: [[String(d.payroll.count), m(d.payroll.amount)]],
            note: t.payrollNote,
          },
        ]
      : []),
    {
      title: t.byAccount!,
      headers: [t.account!, t.count!, t.amount!],
      rows: d.by_account.map((r) => [r.account ?? t.noAccount!, String(r.count), m(r.amount)]),
    },
    {
      title: t.byDay!,
      headers: [t.day!, t.count!, t.amount!],
      rows: d.by_day.map((r) => [r.day, String(r.count), m(r.amount)]),
    },
    {
      title: t.list!,
      headers: [t.number!, t.time!, t.category!, t.account!, t.amount!],
      rows: d.list.map((r) => [
        r.number,
        time(r.at),
        r.category || t.noCategory!,
        r.account ?? t.noAccount!,
        m(r.amount),
      ]),
    },
  ];
}

interface PayrollReportData {
  total: { advances: number; deductions: number; salary: number; net_paid: number; entries: number };
  by_worker: {
    employee: string;
    advances: number;
    deductions: number;
    salary: number;
    net_paid: number;
    carry_out: number;
    entries: number;
  }[];
  entries: {
    number: string;
    at: string;
    employee: string;
    kind: string;
    month: string;
    amount: number;
    net: number | null;
    carry_out: number | null;
    note: string | null;
  }[];
}

/** Payroll: per worker what was advanced, deducted and paid in the period, and every entry. */
export function payrollTables(
  d: PayrollReportData,
  t: ReportLabels,
  time: (iso: string) => string,
  kindName: (k: string) => string,
): ReportTable[] {
  const x = d.total;
  return [
    {
      title: t.title ?? '',
      headers: [t.employeeCol!, t.salaryCol!, t.advancesCol!, t.deductionsCol!, t.netPaid!, t.carryCol!],
      rows: d.by_worker.map((r) => [
        r.employee,
        m(r.salary),
        m(r.advances),
        m(r.deductions),
        m(r.net_paid),
        m(r.carry_out),
      ]),
      totals: [t.total!, m(x.salary), m(x.advances), m(x.deductions), m(x.net_paid), ''],
      note: t.payrollNote,
    },
    {
      title: t.list!,
      headers: [t.number!, t.time!, t.employeeCol!, t.kindCol!, t.monthCol!, t.amount!],
      rows: d.entries.map((r) => [r.number, time(r.at), r.employee, kindName(r.kind), r.month, m(r.amount)]),
    },
  ];
}

interface ReturnsSide {
  total: { count: number; amount: number };
  legacy_count: number;
  by_day: { day: string; count: number; amount: number }[];
  by_product: { product: string; qty: number; amount: number }[];
  by_reason?: { reason: string; count: number; amount: number }[];
  by_method?: { method: string; amount: number }[];
  by_supplier?: { supplier: string; count: number; amount: number }[];
  list: {
    number: string;
    at: string;
    customer?: string;
    supplier?: string;
    reason?: string;
    method?: string;
    amount: number;
    legacy: boolean;
  }[];
}
export interface ReturnsData {
  sales: ReturnsSide;
  purchases: ReturnsSide;
}

/** Returns of one kind (sales or purchases): totals, by reason / method / supplier, by day, by product and the list. */
export function returnsTables(
  d: ReturnsData,
  kind: 'sales' | 'purchases',
  t: ReportLabels,
  time: (iso: string) => string,
  reasonName: (k: string) => string,
  methodName: (k: string) => string,
): ReportTable[] {
  const x = d[kind];
  const all = x.total.amount;
  const note = x.legacy_count > 0 ? `${t.legacyReturns}: ${x.legacy_count}` : undefined;
  const common: ReportTable[] = [
    {
      title: t.byDay!,
      headers: [t.day!, t.count!, t.amount!],
      rows: x.by_day.map((r) => [r.day, String(r.count), m(r.amount)]),
    },
    {
      title: t.byProduct!,
      headers: [t.product!, t.qty!, t.amount!],
      rows: x.by_product.map((r) => [r.product || t.noProduct!, formatQty(r.qty), m(r.amount)]),
    },
  ];
  const head: ReportTable = {
    title: t.title ?? '',
    headers: [t.count!, t.amount!],
    rows: [[String(x.total.count), m(all)]],
    note,
  };
  if (kind === 'purchases')
    return [
      head,
      {
        title: t.bySupplier!,
        headers: [t.supplier!, t.count!, t.amount!, t.share!],
        rows: (x.by_supplier ?? []).map((r) => [
          r.supplier || t.noSupplier!,
          String(r.count),
          m(r.amount),
          `${percentOf(r.amount, all)}%`,
        ]),
        totals: [t.total!, String(x.total.count), m(all), all > 0 ? '100%' : '0%'],
      },
      ...common,
      {
        title: t.list!,
        headers: [t.number!, t.time!, t.supplier!, t.amount!],
        rows: x.list.map((r) => [r.number, time(r.at), r.supplier || t.noSupplier!, m(r.amount)]),
      },
    ];
  return [
    head,
    {
      title: t.byReason!,
      headers: [t.reason!, t.count!, t.amount!, t.share!],
      rows: (x.by_reason ?? []).map((r) => [
        reasonName(r.reason),
        String(r.count),
        m(r.amount),
        `${percentOf(r.amount, all)}%`,
      ]),
      totals: [t.total!, String(x.total.count), m(all), all > 0 ? '100%' : '0%'],
    },
    {
      title: t.byMethod!,
      headers: [t.method!, t.amount!],
      rows: (x.by_method ?? []).map((r) => [methodName(r.method), m(r.amount)]),
    },
    ...common,
    {
      title: t.list!,
      headers: [t.number!, t.time!, t.customer!, t.reason!, t.method!, t.amount!],
      rows: x.list.map((r) => [
        r.number,
        time(r.at),
        r.customer || t.noCustomer!,
        reasonName(r.reason ?? 'unknown'),
        methodName(r.method ?? 'cash'),
        m(r.amount),
      ]),
    },
  ];
}
