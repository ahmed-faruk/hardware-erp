import { formatMoney, formatQty } from './money';
import { percentOf, type ReportLabels, type ReportTable } from './reports';

export interface CatRow {
  /** null = lines of products with no (or a deleted) category */
  id: string | null;
  name: string;
  color: string | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  invoices: number;
  items: number;
  stock_value: number;
}

export interface CategoriesData {
  total: { revenue: number; cost: number; qty: number; stock_value: number };
  categories: CatRow[];
  days: { day: string; category: string | null; revenue: number }[];
}

/** Profit over revenue in basis points (2500 = 25%), 0 when nothing was sold. */
export const marginBp = (profit: number, revenue: number): number =>
  revenue > 0 ? Math.round((profit * 10000) / revenue) : 0;

export interface CategoryKpis {
  topSales: CatRow | null;
  topMargin: CatRow | null;
  active: number;
  biggestStock: CatRow | null;
}

const best = (rows: CatRow[], score: (r: CatRow) => number): CatRow | null =>
  rows.reduce<CatRow | null>((a, r) => (a === null || score(r) > score(a) ? r : a), null);

export function categoryKpis(rows: CatRow[]): CategoryKpis {
  const sold = rows.filter((r) => r.revenue > 0);
  return {
    topSales: best(sold, (r) => r.revenue),
    topMargin: best(sold, (r) => marginBp(r.profit, r.revenue) * 1e9 + r.revenue),
    active: sold.length,
    biggestStock: best(
      rows.filter((r) => r.stock_value > 0),
      (r) => r.stock_value,
    ),
  };
}

/** One row per category: quantity, sales, cost, profit, margin, share of all sales, invoices, stock value. */
export function categoryTables(d: CategoriesData, t: ReportLabels): ReportTable[] {
  return [
    {
      title: t.title ?? '',
      headers: [
        t.category!,
        t.qty!,
        t.sales!,
        t.cost!,
        t.profit!,
        t.margin!,
        t.share!,
        t.invoices!,
        t.stockValue!,
      ],
      rows: d.categories.map((r) => [
        r.name || t.noCategory!,
        formatQty(r.qty),
        formatMoney(r.revenue),
        formatMoney(r.cost),
        formatMoney(r.profit),
        `${Math.round(marginBp(r.profit, r.revenue) / 100)}%`,
        `${percentOf(r.revenue, d.total.revenue)}%`,
        String(r.invoices),
        formatMoney(r.stock_value),
      ]),
      totals: [
        t.total!,
        formatQty(d.total.qty),
        formatMoney(d.total.revenue),
        formatMoney(d.total.cost),
        formatMoney(d.total.revenue - d.total.cost),
        `${Math.round(marginBp(d.total.revenue - d.total.cost, d.total.revenue) / 100)}%`,
        d.total.revenue > 0 ? '100%' : '0%',
        '',
        formatMoney(d.total.stock_value),
      ],
    },
  ];
}

export interface StackKey {
  id: string | null | 'other';
  name: string;
  color: string | null;
}

export interface Stacked {
  keys: StackKey[];
  days: { day: string; values: number[]; total: number }[];
}

/** Daily sales per category for the stacked chart: the `top` best categories get a segment each, everything else is folded into "other". */
export function stackDaily(
  days: CategoriesData['days'],
  rows: CatRow[],
  top = 6,
  otherName = 'أخرى',
): Stacked {
  const ranked = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const shown = ranked.slice(0, top);
  const hasOther = ranked.length > top;
  const keys: StackKey[] = shown.map((r) => ({ id: r.id, name: r.name, color: r.color }));
  if (hasOther) keys.push({ id: 'other', name: otherName, color: null });
  const index = new Map<string | null, number>(shown.map((r, i) => [r.id, i]));
  const byDay = new Map<string, number[]>();
  for (const d of days) {
    const values = byDay.get(d.day) ?? new Array<number>(keys.length).fill(0);
    const i = index.get(d.category) ?? (hasOther ? keys.length - 1 : -1);
    if (i >= 0) values[i] = values[i]! + d.revenue;
    byDay.set(d.day, values);
  }
  return {
    keys,
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, values]) => ({ day, values, total: values.reduce((a, v) => a + v, 0) })),
  };
}
