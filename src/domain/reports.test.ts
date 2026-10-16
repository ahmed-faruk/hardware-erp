import { describe, expect, it } from 'vitest';

import {
  devicesTable,
  supplierDetailTables,
  expensesTables,
  historyTable,
  payrollTables,
  percentOf,
  profitTable,
  purchasesTables,
  returnsTables,
  salesTables,
  stockTable,
} from './reports';

const t = new Proxy({}, { get: (_, k) => String(k) }) as Record<string, string>;

describe('report tables', () => {
  it('sales: a row per day, totals, and the method / cashier splits', () => {
    const tables = salesTables(
      {
        days: [{ day: '2026-10-01', invoices: 2, gross: 15000, returns: 0, net: 15000 }],
        total: { invoices: 2, gross: 15000, returns: 0, net: 15000 },
        by_method: [{ method: 'cash', amount: 10000 }],
        by_worker: [{ worker: 'عبدالله', invoices: 2, gross: 15000 }],
        legacy_invoices: 1,
      },
      t,
      (k) => k.toUpperCase(),
    );
    expect(tables[0]!.rows[0]).toEqual(['2026-10-01', '2', '150.00', '0.00', '150.00']);
    expect(tables[0]!.totals).toEqual(['total', '2', '150.00', '0.00', '150.00']);
    expect(tables[0]!.note).toBe('legacy: 1');
    expect(tables[1]!.rows).toEqual([['CASH', '100.00']]);
    expect(tables[2]!.rows[0]![0]).toBe('عبدالله');
  });
  it('profit carries its explanation', () => {
    const r = profitTable({ days: [], total: { revenue: 14000, cost: 3400, profit: 10600 } }, t);
    expect(r.totals).toEqual(['total', '140.00', '34.00', '106.00']);
    expect(r.note).toBe('profitNote');
  });
  it('stock: value = qty x cost, marks rows under the reorder level', () => {
    const r = stockTable(
      [
        { name: 'A', sku: null, qtyMilli: 2500, unitCost: 400, reorderLevel: 5000 },
        { name: 'B', sku: null, qtyMilli: 10000, unitCost: 100, reorderLevel: 0 },
      ],
      t,
    );
    expect(r.rows[0]).toEqual(['A', '2.5', '4.00', '10.00', 'low']);
    expect(r.rows[1]![4]).toBe('');
    expect(r.totals![3]).toBe('20.00');
  });
  it('devices: never seen and revoked read clearly', () => {
    const r = devicesTable(
      [
        {
          name: 'K1',
          prefix: 'K1',
          last_seen_at: null,
          app_version: null,
          revoked: true,
          open_shift: false,
          errors_24h: 0,
        },
      ],
      t,
      (x) => x,
    );
    expect(r.rows[0]).toEqual(['K1 (K1) — revoked', 'never', '', '', '0']);
  });
});

describe('exceptions report extras', () => {
  it('lists the audit counters and the setting changes', async () => {
    const { exceptionsTables } = await import('./reports');
    const tables = exceptionsTables(
      {
        voids: [],
        reprints: 0,
        no_sales: [],
        discounts: { lines: 0, amount: 0 },
        stock_adjustments: [],
        shift_variances: [],
        negative_stock: 2,
        price_overrides: 3,
        discount_overrides: 1,
        pin_failures: 4,
        cart_removals: 5,
        settings_changes: [{ key: 'sale.cashierMayDiscount', at: '2026-10-10T09:00:00Z', worker: 'م' }],
        clock_warnings: [],
      },
      t,
      (x) => x,
      (x) => x,
    );
    const summary = Object.fromEntries(tables[0]!.rows.map((r) => [r[0], r[1]]));
    expect(summary).toMatchObject({
      negativeStock: '2',
      priceOverrides: '3',
      discountOverrides: '1',
      pinFailures: '4',
      cartRemovals: '5',
    });
    expect(tables.find((x) => x.title === 'settingsChanges')?.rows[0]![0]).toBe('sale.cashierMayDiscount');
  });
});

describe('purchases report', () => {
  const totals = {
    invoices: 1,
    total: 10000,
    safe: 4000,
    owner: 3000,
    other: 0,
    credit: 3000,
    returns: 0,
    later_owner: 1000,
    later_other: 0,
  };
  it('splits a purchase by where the money came from, in total and per supplier', () => {
    const tables = purchasesTables(
      { total: totals, by_supplier: [{ ...totals, supplier: 'مورد' }], legacy_invoices: 0 },
      t,
    );
    expect(tables[0]!.rows).toEqual([
      ['invoices', '1'],
      ['purchTotal', '100.00'],
      ['fromSafe', '40.00'],
      ['fromOwner', '30.00'],
      ['otherPay', '0.00'],
      ['onCredit', '30.00'],
      ['returns', '0.00'],
      ['laterOwner', '10.00'],
      ['laterOther', '0.00'],
    ]);
    expect(tables[1]!.rows).toEqual([['مورد', '100.00', '40.00', '30.00', '30.00', '0.00']]);
    expect(tables[1]!.totals).toEqual(['total', '100.00', '40.00', '30.00', '30.00', '0.00']);
  });
});

describe('item history report', () => {
  it('shows what came in, what went out and the balance after, with a tag on imported rows', () => {
    const r = historyTable(
      [
        {
          at: '2026-10-06T10:00:00Z',
          doc_type: 'purchase_invoice',
          number: 'K1-PUR-000001',
          party: 'مورد',
          in_qty: 5000,
          out_qty: 0,
          balance: 13000,
          legacy: false,
        },
        {
          at: '2026-05-01T10:00:00Z',
          doc_type: 'sales_invoice',
          number: 'OSPOS-S1',
          party: null,
          in_qty: 0,
          out_qty: 3000,
          balance: 10000,
          legacy: true,
        },
      ],
      t,
      (iso) => iso.slice(0, 10),
      (k) => k.toUpperCase(),
    );
    expect(r.headers).toHaveLength(7);
    expect(r.rows[0]).toEqual(['2026-10-06', 'PURCHASE_INVOICE', 'K1-PUR-000001', 'مورد', '5', '', '13']);
    expect(r.rows[1]).toEqual(['2026-05-01', 'SALES_INVOICE (legacyTag)', 'OSPOS-S1', '', '', '3', '10']);
    expect(r.note).toBe('historyNote');
  });
});

describe('expenses report', () => {
  const d = {
    total: { count: 3, amount: 20000 },
    by_category: [
      { category: 'كهرباء', count: 1, amount: 15000 },
      { category: '', count: 2, amount: 5000 },
    ],
    by_account: [
      { account: 'درج', count: 2, amount: 18500 },
      { account: null, count: 1, amount: 1500 },
    ],
    by_day: [{ day: '2026-10-01', count: 1, amount: 15000 }],
    list: [
      {
        number: 'K1-EXP-000001',
        at: '2026-10-01T10:00:00Z',
        category: 'كهرباء',
        account: 'درج',
        amount: 15000,
        legacy: false,
        note: null,
      },
    ],
    legacy_count: 1,
  };
  it('totals by category with each share, and names what has no category or account', () => {
    const r = expensesTables(d, t, (iso) => iso.slice(0, 10));
    expect(r[0]!.rows).toEqual([
      ['كهرباء', '1', '150.00', '75%'],
      ['noCategory', '2', '50.00', '25%'],
    ]);
    expect(r[0]!.totals).toEqual(['total', '3', '200.00', '100%']);
    expect(r[0]!.note).toBe('legacy: 1');
    expect(r[1]!.rows[1]).toEqual(['noAccount', '1', '15.00']);
    expect(r[3]!.rows[0]).toEqual(['K1-EXP-000001', '2026-10-01', 'كهرباء', 'درج', '150.00']);
  });
  it('rounds a share half up and is 0 for an empty period', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe('payroll report', () => {
  it('lists per worker what was advanced, deducted and paid, and every entry', () => {
    const r = payrollTables(
      {
        total: { advances: 50000, deductions: 10000, salary: 300000, net_paid: 240000, entries: 3 },
        by_worker: [
          {
            employee: 'علاء',
            advances: 50000,
            deductions: 10000,
            salary: 300000,
            net_paid: 240000,
            carry_out: 0,
            entries: 3,
          },
        ],
        entries: [
          {
            number: 'K1-SAL-000001',
            at: '2026-10-31T10:00:00Z',
            employee: 'علاء',
            kind: 'salary',
            month: '2026-10',
            amount: 240000,
            net: 240000,
            carry_out: 0,
            note: null,
          },
        ],
      },
      t,
      (iso) => iso.slice(0, 10),
      (k) => k.toUpperCase(),
    );
    expect(r[0]!.rows).toEqual([['علاء', '3000.00', '500.00', '100.00', '2400.00', '0.00']]);
    expect(r[0]!.totals).toEqual(['total', '3000.00', '500.00', '100.00', '2400.00', '']);
    expect(r[1]!.rows[0]).toEqual(['K1-SAL-000001', '2026-10-31', 'علاء', 'SALARY', '2026-10', '2400.00']);
  });
  it('the expenses report shows the net salaries as their own line', () => {
    const base = {
      total: { count: 0, amount: 0 },
      by_category: [],
      by_account: [],
      by_day: [],
      list: [],
      legacy_count: 0,
    };
    expect(
      expensesTables({ ...base, payroll: { count: 2, amount: 480000 } }, t, (i) => i).map((x) => x.title),
    ).toContain('payrollTitle');
    expect(
      expensesTables({ ...base, payroll: { count: 0, amount: 0 } }, t, (i) => i).map((x) => x.title),
    ).not.toContain('payrollTitle');
  });
});

describe('returns report (F5)', () => {
  const labels = {
    title: 'مرتجعات المبيعات',
    count: 'العدد',
    amount: 'المبلغ',
    share: 'النسبة',
    total: 'الإجمالي',
    byDay: 'حسب اليوم',
    day: 'اليوم',
    byProduct: 'حسب الصنف',
    product: 'الصنف',
    qty: 'الكمية',
    byReason: 'حسب السبب',
    reason: 'السبب',
    byMethod: 'حسب الطريقة',
    method: 'الطريقة',
    bySupplier: 'حسب المورد',
    supplier: 'المورد',
    customer: 'العميل',
    list: 'القائمة',
    number: 'الرقم',
    time: 'الوقت',
    noCustomer: 'بدون عميل',
    noSupplier: 'مورد غير معروف',
    noProduct: 'صنف غير معروف',
    legacyReturns: 'مرتجعات قديمة',
  };
  const side = {
    total: { count: 2, amount: 4000 },
    legacy_count: 1,
    by_day: [{ day: '2026-10-05', count: 2, amount: 4000 }],
    by_product: [{ product: 'دهان', qty: 3000, amount: 4000 }],
    by_reason: [
      { reason: 'defect', count: 1, amount: 3000 },
      { reason: 'unknown', count: 1, amount: 1000 },
    ],
    by_method: [{ method: 'cash', amount: 4000 }],
    by_supplier: [{ supplier: '', count: 2, amount: 4000 }],
    list: [
      {
        number: 'K1-RET-1',
        at: '2026-10-05T10:00:00Z',
        customer: '',
        reason: 'defect',
        method: 'cash',
        amount: 3000,
        legacy: false,
      },
      {
        number: 'LG-RET-000001',
        at: '2026-10-05T00:00:00Z',
        supplier: 'مورد',
        reason: 'unknown',
        method: 'legacy',
        amount: 1000,
        legacy: true,
      },
    ],
  };
  const data = { sales: side, purchases: side };
  const time = (iso: string): string => iso.slice(0, 10);
  const name = (k: string): string => `<${k}>`;

  it('sales: totals, reasons with their share, methods, days, products and the list', () => {
    const t = returnsTables(data, 'sales', labels, time, name, name);
    expect(t.map((x) => x.title)).toEqual([
      'مرتجعات المبيعات',
      'حسب السبب',
      'حسب الطريقة',
      'حسب اليوم',
      'حسب الصنف',
      'القائمة',
    ]);
    expect(t[0]).toMatchObject({ rows: [['2', '40.00']], note: 'مرتجعات قديمة: 1' });
    expect(t[1]?.rows).toEqual([
      ['<defect>', '1', '30.00', '75%'],
      ['<unknown>', '1', '10.00', '25%'],
    ]);
    expect(t[1]?.totals).toEqual(['الإجمالي', '2', '40.00', '100%']);
    expect(t[4]?.rows).toEqual([['دهان', '3', '40.00']]);
    expect(t[5]?.rows[0]).toEqual(['K1-RET-1', '2026-10-05', 'بدون عميل', '<defect>', '<cash>', '30.00']);
  });

  it('purchases: by supplier (an unknown supplier is named) and the list', () => {
    const t = returnsTables(data, 'purchases', labels, time, name, name);
    expect(t.map((x) => x.title)).toEqual([
      'مرتجعات المبيعات',
      'حسب المورد',
      'حسب اليوم',
      'حسب الصنف',
      'القائمة',
    ]);
    expect(t[1]?.rows).toEqual([['مورد غير معروف', '2', '40.00', '100%']]);
    expect(t[4]?.rows[1]).toEqual(['LG-RET-000001', '2026-10-05', 'مورد', '10.00']);
  });

  it('an empty period gives empty tables, not errors', () => {
    const empty = { total: { count: 0, amount: 0 }, legacy_count: 0, by_day: [], by_product: [], list: [] };
    const t = returnsTables({ sales: empty, purchases: empty }, 'sales', labels, time, name, name);
    expect(t[0]).toMatchObject({ rows: [['0', '0.00']], note: undefined });
    expect(t[1]?.totals).toEqual(['الإجمالي', '0', '0.00', '0%']);
  });
});

describe('supplierDetailTables', () => {
  const t = {
    invoices: 'inv',
    invoiceNumber: 'no',
    day: 'day',
    amount: 'amt',
    total: 'tot',
    topProducts: 'top',
  };
  it('makes one table per supplier with the count, the invoices, the total and the top products', () => {
    const out = supplierDetailTables(
      {
        suppliers: [
          {
            supplier_id: 'a',
            name: 'S',
            invoices: 2,
            total: 4000,
            list: [
              { number: 'P-2', day: '2026-03-02', total: 1000 },
              { number: 'P-1', day: '2026-03-01', total: 3000 },
            ],
            top: [{ name: 'Paint', net: 3000 }],
          },
        ],
      },
      t,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('S · inv: 2');
    expect(out[0]!.rows).toEqual([
      ['P-2', '2026-03-02', '10.00'],
      ['P-1', '2026-03-01', '30.00'],
    ]);
    expect(out[0]!.totals).toEqual(['tot', '', '40.00']);
    expect(out[0]!.note).toBe('top: Paint (30.00)');
  });
  it('has no note without products', () => {
    const out = supplierDetailTables(
      { suppliers: [{ supplier_id: 'a', name: 'S', invoices: 0, total: 0, list: [], top: [] }] },
      t,
    );
    expect(out[0]!.note).toBeUndefined();
  });
});
