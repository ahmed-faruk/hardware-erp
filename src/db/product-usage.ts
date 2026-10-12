import { NO_USAGE, type ProductUsage } from '@/domain/product-usage';

import type { HanafyDB } from './schema';

const hasProduct = (row: unknown, id: string): boolean => (row as { productId?: unknown }).productId === id;

/** What this device knows about a product: the document lines and stock movements that point at it. */
export async function localProductUsage(db: HanafyDB, productId: string): Promise<ProductUsage> {
  const [sales, salesReturns, purchases, purchaseReturns, adjustments, movements] = await Promise.all([
    db.salesInvoiceLines.filter((l) => hasProduct(l, productId)).count(),
    db.salesReturnLines.filter((l) => hasProduct(l, productId)).count(),
    db.purchaseInvoiceLines.filter((l) => hasProduct(l, productId)).count(),
    db.purchaseReturnLines.filter((l) => hasProduct(l, productId)).count(),
    db.stockAdjustmentLines.filter((l) => hasProduct(l, productId)).count(),
    db.stockMovements.filter((m) => m.productId === productId && !m.deletedAt).toArray(),
  ]);
  return {
    ...NO_USAGE,
    sales,
    salesReturns,
    purchases,
    purchaseReturns,
    adjustments,
    movements: movements.length,
    stockMilli: movements.reduce((a, m) => a + (m.qty as number), 0),
  };
}
