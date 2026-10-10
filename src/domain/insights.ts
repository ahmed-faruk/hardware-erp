import type { Milli, Piasters } from './money';

/** Days the supplier needs to deliver, and the extra days of sales kept as a cushion (owner-approved defaults; not settings yet). */
export const LEAD_DAYS = 3;
export const SAFETY_DAYS = 3;
export const HEAT_FIRST_HOUR = 9;
export const HEAT_LAST_HOUR = 21;

/** What the screen knows about one stocked product over the last 30 days. */
export interface ProductFacts {
  id: string;
  name: string;
  stockMilli: Milli;
  unitCost: Piasters;
  price: Piasters;
  supplierName: string;
  /** base-unit quantity sold in the last 30 days, net of returns */
  sold30Milli: Milli;
  /** Cairo day (yyyy-mm-dd) of the last sale, null when never sold */
  lastSoldDay: string | null;
  revenue30: Piasters;
}

export type Urgency = 'now' | 'soon' | 'normal';

export interface ReorderRow {
  productId: string;
  name: string;
  stockMilli: Milli;
  perDayMilli: Milli;
  daysLeft: number;
  reorderPointMilli: Milli;
  suggestMilli: Milli;
  cost: Piasters;
  supplierName: string;
  urgency: Urgency;
}

const ceilUnits = (milli: number): Milli => Math.ceil(milli / 1000) * 1000;

/**
 * What to buy and when. Sales speed = last 30 days / 30. Quantity covers `coverDays` after the delivery
 * (lead time + cover) minus what is on the shelf, rounded up to whole units. Reorder point = lead + safety days of sales.
 */
export function reorderPlan(products: ProductFacts[], coverDays: number): ReorderRow[] {
  const rows: ReorderRow[] = [];
  for (const p of products) {
    if (p.sold30Milli <= 0) continue;
    const daysLeft = Math.max(0, Math.floor((p.stockMilli * 30) / p.sold30Milli));
    const need = Math.ceil((p.sold30Milli * (LEAD_DAYS + coverDays)) / 30) - p.stockMilli;
    if (need <= 0) continue;
    const suggestMilli = ceilUnits(need);
    const urgency: Urgency =
      daysLeft <= LEAD_DAYS ? 'now' : daysLeft <= LEAD_DAYS + SAFETY_DAYS ? 'soon' : 'normal';
    rows.push({
      productId: p.id,
      name: p.name,
      stockMilli: p.stockMilli,
      perDayMilli: Math.round(p.sold30Milli / 30),
      daysLeft,
      reorderPointMilli: Math.ceil((p.sold30Milli * (LEAD_DAYS + SAFETY_DAYS)) / 30),
      suggestMilli,
      cost: Math.round((suggestMilli * p.unitCost) / 1000),
      supplierName: p.supplierName,
      urgency,
    });
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

export interface DeadRow {
  productId: string;
  name: string;
  stockMilli: Milli;
  value: Piasters;
  daysIdle: number | null;
}

/** Products on the shelf that did not sell for `days` days (or never): the cash tied up in them. */
export function deadStock(products: ProductFacts[], today: string, days: number): DeadRow[] {
  const rows: DeadRow[] = [];
  for (const p of products) {
    if (p.stockMilli <= 0) continue;
    const idle = p.lastSoldDay ? daysBetween(p.lastSoldDay, today) : null;
    if (idle !== null && idle < days) continue;
    rows.push({
      productId: p.id,
      name: p.name,
      stockMilli: p.stockMilli,
      value: Math.round((p.stockMilli * p.unitCost) / 1000),
      daysIdle: idle,
    });
  }
  return rows.sort((a, b) => b.value - a.value);
}

export interface TopRow {
  productId: string;
  name: string;
  revenue: Piasters;
  sharePercent: number;
}

export function topSellers(products: ProductFacts[], count: number): TopRow[] {
  const sorted = products
    .filter((p) => p.revenue30 > 0)
    .sort((a, b) => b.revenue30 - a.revenue30)
    .slice(0, count);
  const best = sorted[0]?.revenue30 ?? 1;
  return sorted.map((p) => ({
    productId: p.id,
    name: p.name,
    revenue: p.revenue30,
    sharePercent: Math.round((p.revenue30 * 100) / best),
  }));
}

/** One posted sales invoice, reduced to what the patterns need. weekday: 0 = Saturday … 6 = Friday (Cairo). */
export interface SaleEvent {
  customerId: string | null;
  day: string;
  hour: number;
  weekday: number;
  total: Piasters;
}

export type CadenceStatus = 'late' | 'soon' | 'ontime';

export interface CadenceRow {
  customerId: string;
  spend: Piasters;
  avgOrder: Piasters;
  everyDays: number;
  daysSinceLast: number;
  status: CadenceStatus;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/** How often each customer buys and who is overdue: late = past 1.25 × the usual gap, soon = past 0.75 ×. */
export function customerCadence(events: SaleEvent[], today: string): CadenceRow[] {
  const byCustomer = new Map<string, SaleEvent[]>();
  for (const e of events) {
    if (!e.customerId) continue;
    const l = byCustomer.get(e.customerId) ?? [];
    l.push(e);
    byCustomer.set(e.customerId, l);
  }
  const rows: CadenceRow[] = [];
  for (const [customerId, list] of byCustomer) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.day.localeCompare(b.day));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push(daysBetween(list[i - 1]!.day, list[i]!.day));
    const everyDays = Math.max(1, median(gaps));
    const spend = list.reduce((a, e) => a + e.total, 0);
    const daysSinceLast = daysBetween(list[list.length - 1]!.day, today);
    rows.push({
      customerId,
      spend,
      avgOrder: Math.round(spend / list.length),
      everyDays,
      daysSinceLast,
      status:
        daysSinceLast * 4 > everyDays * 5 ? 'late' : daysSinceLast * 4 >= everyDays * 3 ? 'soon' : 'ontime',
    });
  }
  return rows.sort((a, b) => b.spend - a.spend);
}

export interface Heat {
  /** 7 weekdays × (HEAT_LAST_HOUR − HEAT_FIRST_HOUR + 1) hours, each 0..100 of the busiest cell */
  cells: number[][];
  busiest: { weekday: number; hour: number } | null;
}

export function hourHeat(events: SaleEvent[]): Heat {
  const width = HEAT_LAST_HOUR - HEAT_FIRST_HOUR + 1;
  const counts = Array.from({ length: 7 }, () => new Array<number>(width).fill(0));
  let best = 0;
  let at: Heat['busiest'] = null;
  for (const e of events) {
    const col = e.hour - HEAT_FIRST_HOUR;
    if (col < 0 || col >= width) continue;
    const n = ++counts[e.weekday]![col]!;
    if (n > best) {
      best = n;
      at = { weekday: e.weekday, hour: e.hour };
    }
  }
  return {
    cells: counts.map((row) => row.map((n) => (best ? Math.round((n * 100) / best) : 0))),
    busiest: at,
  };
}
