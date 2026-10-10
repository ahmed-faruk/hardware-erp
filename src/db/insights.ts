import type { Milli, Piasters } from '@/domain/money';
import type { ProductFacts, SaleEvent } from '@/domain/insights';

import type { HanafyDB } from './schema';

export interface Kpis {
  todayNet: Piasters;
  todayInvoices: number;
  avgBasket: Piasters;
  stockValue: Piasters;
  receivables: Piasters;
  payables: Piasters;
}

export interface InsightsData {
  today: string;
  kpis: Kpis;
  products: ProductFacts[];
  events: SaleEvent[];
  customerNames: Map<string, string>;
}

const WEEKDAYS: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

/** Cairo calendar day, hour and weekday (0 = Saturday) of an instant. */
export function cairoParts(iso: string): { day: string; hour: number; weekday: number } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(d),
  );
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short' }).format(d);
  return { day, hour: hour % 24, weekday: WEEKDAYS[wd] ?? 0 };
}

/**
 * Everything the smart report needs, read from this device (so it works offline and includes the imported history).
 * Sales speed uses the last 30 days of posted invoices, gross of returns.
 */
export async function loadInsights(db: HanafyDB, now = new Date()): Promise<InsightsData> {
  const today = cairoParts(now.toISOString()).day;
  const since = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();
  const cut30 = since(30);
  const [invoices, products, balances, suppliers, customers, parties] = await Promise.all([
    db.salesInvoices.where('issuedAt').aboveOrEqual(since(90)).toArray(),
    db.products.toArray(),
    db.stockBalances.toArray(),
    db.suppliers.toArray(),
    db.customers.toArray(),
    db.partyBalances.toArray(),
  ]);
  const posted = invoices.filter((i) => i.status === 'posted');
  const events: SaleEvent[] = posted.map((i) => ({
    customerId: i.customerId,
    total: i.total,
    ...cairoParts(i.issuedAt),
  }));

  const recent = posted.filter((i) => i.issuedAt >= cut30);
  const dayOf = new Map(recent.map((i) => [i.id, cairoParts(i.issuedAt).day]));
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

  const todays = posted.filter((i) => cairoParts(i.issuedAt).day === today);
  const todayNet = todays.reduce((a, i) => a + i.total, 0);
  const sumParty = (type: 'customer' | 'supplier', sign: 1 | -1): Piasters =>
    parties.filter((p) => p.partyType === type).reduce((a, p) => a + Math.max(0, sign * p.amount), 0);
  return {
    today,
    kpis: {
      todayNet,
      todayInvoices: todays.length,
      avgBasket: todays.length ? Math.round(todayNet / todays.length) : 0,
      stockValue: facts.reduce((a, p) => a + Math.round((Math.max(0, p.stockMilli) * p.unitCost) / 1000), 0),
      receivables: sumParty('customer', 1),
      payables: sumParty('supplier', -1),
    },
    products: facts,
    events,
    customerNames: new Map(customers.map((c) => [c.id, c.name])),
  };
}
