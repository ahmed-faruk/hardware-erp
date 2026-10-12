/** What touches a product. A product can be deleted only when nothing does. */
export interface ProductUsage {
  sales: number;
  salesReturns: number;
  purchases: number;
  purchaseReturns: number;
  movements: number;
  adjustments: number;
  /** imported OpenSourcePOS history (it lives on the server only) */
  legacySales: number;
  legacyPurchases: number;
  stockMilli: number;
}

export type UsageReason = 'sales' | 'purchases' | 'returns' | 'movements' | 'legacy' | 'stock';

export const NO_USAGE: ProductUsage = {
  sales: 0,
  salesReturns: 0,
  purchases: 0,
  purchaseReturns: 0,
  movements: 0,
  adjustments: 0,
  legacySales: 0,
  legacyPurchases: 0,
  stockMilli: 0,
};

/** The reasons that block a delete, in the order they are shown. Empty = the product may be deleted. */
export function usageReasons(u: ProductUsage): UsageReason[] {
  const out: UsageReason[] = [];
  if (u.sales > 0) out.push('sales');
  if (u.purchases > 0) out.push('purchases');
  if (u.salesReturns + u.purchaseReturns > 0) out.push('returns');
  if (u.movements + u.adjustments > 0) out.push('movements');
  if (u.legacySales + u.legacyPurchases > 0) out.push('legacy');
  if (u.stockMilli !== 0) out.push('stock');
  return out;
}

/** The answer of the server RPC `product_usage` (snake_case) as a ProductUsage. */
export function usageFromServer(d: Record<string, unknown>): ProductUsage {
  const n = (k: string): number => Number(d[k] ?? 0);
  return {
    sales: n('sales'),
    salesReturns: n('sales_returns'),
    purchases: n('purchases'),
    purchaseReturns: n('purchase_returns'),
    movements: n('movements'),
    adjustments: n('adjustments'),
    legacySales: n('legacy_sales'),
    legacyPurchases: n('legacy_purchases'),
    stockMilli: n('stock_milli'),
  };
}

/** Local counts plus the server's: the larger of each, so neither side can hide a use of the product. */
export function mergeUsage(a: ProductUsage, b: ProductUsage): ProductUsage {
  return {
    sales: Math.max(a.sales, b.sales),
    salesReturns: Math.max(a.salesReturns, b.salesReturns),
    purchases: Math.max(a.purchases, b.purchases),
    purchaseReturns: Math.max(a.purchaseReturns, b.purchaseReturns),
    movements: Math.max(a.movements, b.movements),
    adjustments: Math.max(a.adjustments, b.adjustments),
    legacySales: Math.max(a.legacySales, b.legacySales),
    legacyPurchases: Math.max(a.legacyPurchases, b.legacyPurchases),
    stockMilli: Math.abs(a.stockMilli) >= Math.abs(b.stockMilli) ? a.stockMilli : b.stockMilli,
  };
}
