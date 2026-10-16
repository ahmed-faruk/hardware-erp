import type { Milli, Piasters } from '@/domain/money';
import { mostReturned, type ProductFacts, type ReturnedRow, type SaleEvent } from '@/domain/insights';

import type { HanafyDB } from './schema';

export interface Kpis {
  todayNet: Piasters;
  todayInvoices: number;
  avgBasket: Piasters;
  stockValue: Piasters;
  receivables: Piasters;
  payables: Piasters;
  /** posted expenses since the 1st of this Cairo month */
  monthExpenses: Piasters;
}

export interface ReturnsToday {
  count: number;
  value: Piasters;
}

export interface InsightsData {
  today: string;
  returnsToday: { sales: ReturnsToday; purchases: ReturnsToday };
  /** the most returned products of the last 30 days */
  returned: ReturnedRow[];
  kpis: Kpis;
  products: ProductFacts[];
  events: SaleEvent[];
  customerNames: Map<string, string>;
  /** the three categories that sold most in the last 30 days, with their revenue */
  topCategories: { id: string | null; name: string; revenue: Piasters }[];
}

const WEEKDAYS: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

// building an Intl.DateTimeFormat costs far more than formatting with one: made once, not once per invoice
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  hour12: false,
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short' });

/** Cairo calendar day, hour and weekday (0 = Saturday) of an instant. */
export function cairoParts(iso: string): { day: string; hour: number; weekday: number } {
  const d = new Date(iso);
  return {
    day: DAY_FORMAT.format(d),
    hour: Number(HOUR_FORMAT.format(d)) % 24,
    weekday: WEEKDAYS[WEEKDAY_FORMAT.format(d)] ?? 0,
  };
}

/**
 * Everything the smart report needs, read from this device (so it works offline and includes the imported history).
 * Sales speed and revenue use the last 30 days of posted invoices net of the returns; today's sales are net of today's returns.
 */
export async function loadInsights(db: HanafyDB, now = new Date()): Promise<InsightsData> {
  const today = cairoParts(now.toISOString()).day;
  const since = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();
  const cut30 = since(30);
  const monthFirst = `${today.slice(0, 8)}01`;
  const [
    invoices,
    products,
    balances,
    suppliers,
    customers,
    parties,
    expenses,
    categories,
    salesReturns,
    purchaseReturns,
  ] = await Promise.all([
    db.salesInvoices.where('issuedAt').aboveOrEqual(since(90)).toArray(),
    db.products.toArray(),
    db.stockBalances.toArray(),
    db.suppliers.toArray(),
    db.customers.toArray(),
    db.partyBalances.toArray(),
    db.expenses.where('issuedAt').aboveOrEqual(`${monthFirst}T00:00:00`).toArray(),
    db.categories.toArray(),
    db.salesReturns.filter((r) => r.status === 'posted' && (r.issuedAt as string) >= cut30).toArray(),
    db.purchaseReturns.filter((r) => r.status === 'posted' && (r.issuedAt as string) >= cut30).toArray(),
  ]);
  const posted = invoices.filter((i) => i.status === 'posted');
  const parts = new Map(posted.map((i) => [i.id, cairoParts(i.issuedAt)]));
  const events: SaleEvent[] = posted.map((i) => ({
    customerId: i.customerId,
    total: i.total,
    ...parts.get(i.id)!,
  }));

  const recent = posted.filter((i) => i.issuedAt >= cut30);
  const dayOf = new Map(recent.map((i) => [i.id, parts.get(i.id)!.day]));
  const lines = await db.salesInvoiceLines
    .where('invoiceId')
    .anyOf([...dayOf.keys()])
    .toArray();
  const sold = new Map<string, { milli: Milli; revenue: Piasters; last: string }>();
  for (const l of lines) {
    if (!l.productId) continue;
    const e = sold.get(l.productId) ?? { milli: 0, revenue: 0, last: '' };
    e.milli += Math.round((l.qty * l.unitFactor) / 1000);
    e.revenue += l.netAmount;
    const d = dayOf.get(l.invoiceId) ?? '';
    if (d > e.last) e.last = d;
    sold.set(l.productId, e);
  }

  // returns of the last 30 days: speed and revenue are net of them, the most returned products show their share
  const retLines = await db.salesReturnLines
    .where('returnId')
    .anyOf(salesReturns.map((r) => r.id))
    .toArray();
  const originals = await db.salesInvoiceLines.bulkGet(
    retLines.map((l) => (l.originalLineId as string | null) ?? ''),
  );
  const soldGross = new Map<string, Milli>();
  for (const [id, e] of sold) soldGross.set(id, e.milli);
  const returnedMilli = new Map<string, Milli>();
  retLines.forEach((l, i) => {
    const id = l.productId as string | null;
    if (!id) return;
    const milli = Math.round(((l.qty as number) * (originals[i]?.unitFactor ?? 1000)) / 1000);
    returnedMilli.set(id, (returnedMilli.get(id) ?? 0) + milli);
    const e = sold.get(id) ?? { milli: 0, revenue: 0, last: '' };
    e.milli -= milli;
    e.revenue -= l.netAmount as number;
    sold.set(id, e);
  });

  const stock = new Map<string, Milli>();
  for (const b of balances) stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const facts: ProductFacts[] = products
    .filter((p) => !p.deletedAt && p.active && p.type === 'stock')
    .map((p) => {
      const s = sold.get(p.id);
      return {
        id: p.id,
        name: p.name,
        stockMilli: stock.get(p.id) ?? 0,
        unitCost: p.unitCost,
        price: p.price,
        supplierName: (p.defaultSupplierId && supplierName.get(p.defaultSupplierId)) || '',
        sold30Milli: s?.milli ?? 0,
        lastSoldDay: s?.last || null,
        revenue30: s?.revenue ?? 0,
      };
    });

  const todays = posted.filter((i) => parts.get(i.id)!.day === today);
  const salesBackToday = salesReturns.filter((r) => cairoParts(r.issuedAt as string).day === today);
  const purchasesBackToday = purchaseReturns.filter((r) => cairoParts(r.issuedAt as string).day === today);
  const sumTotal = (rows: Record<string, unknown>[]): Piasters =>
    rows.reduce((a, r) => a + Number(r.total ?? 0), 0);
  const todayNet = todays.reduce((a, i) => a + i.total, 0) - sumTotal(salesBackToday);
  const sumParty = (type: 'customer' | 'supplier', sign: 1 | -1): Piasters =>
    parties.filter((p) => p.partyType === type).reduce((a, p) => a + Math.max(0, sign * p.amount), 0);
  return {
    today,
    returnsToday: {
      sales: { count: salesBackToday.length, value: sumTotal(salesBackToday) },
      purchases: { count: purchasesBackToday.length, value: sumTotal(purchasesBackToday) },
    },
    returned: mostReturned(returnedMilli, soldGross, new Map(products.map((p) => [p.id, p.name]))),
    kpis: {
      todayNet,
      todayInvoices: todays.length,
      avgBasket: todays.length ? Math.round(todayNet / todays.length) : 0,
      stockValue: facts.reduce((a, p) => a + Math.round((Math.max(0, p.stockMilli) * p.unitCost) / 1000), 0),
      receivables: sumParty('customer', 1),
      payables: sumParty('supplier', -1),
      monthExpenses: expenses
        .filter((e) => e.status === 'posted' && cairoParts(e.issuedAt).day >= monthFirst)
        .reduce((a, e) => a + (e.amount as number), 0),
    },
    products: facts,
    events,
    customerNames: new Map(customers.map((c) => [c.id, c.name])),
    topCategories: topCategories(
      products.map((p) => ({ id: p.id, categoryId: p.categoryId })),
      sold,
      new Map(categories.map((c) => [c.id, c.name])),
    ),
  };
}

function topCategories(
  products: { id: string; categoryId: string | null }[],
  sold: Map<string, { revenue: Piasters }>,
  names: Map<string, string>,
): InsightsData['topCategories'] {
  const byProduct = new Map(products.map((p) => [p.id, p.categoryId]));
  const sum = new Map<string | null, Piasters>();
  for (const [productId, s] of sold) {
    const cat = byProduct.get(productId) ?? null;
    sum.set(cat, (sum.get(cat) ?? 0) + s.revenue);
  }
  return [...sum.entries()]
    .filter(([, revenue]) => revenue > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, revenue]) => ({ id, name: (id && names.get(id)) || '', revenue }));
}
