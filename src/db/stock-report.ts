import type { HanafyDB } from './schema';
import type { StockRow } from '@/domain/reports';

/** Stock on hand from this device: quantity summed over warehouses, cost and reorder level per product. */
export async function loadStockRows(db: HanafyDB): Promise<StockRow[]> {
  const [products, balances] = await Promise.all([db.products.toArray(), db.stockBalances.toArray()]);
  const qty = new Map<string, number>();
  for (const b of balances) qty.set(b.productId, (qty.get(b.productId) ?? 0) + b.qty);
  return products
    .filter((p) => !p.deletedAt && p.active && p.type === 'stock')
    .map((p) => ({
      name: p.name,
      sku: p.sku,
      qtyMilli: qty.get(p.id) ?? 0,
      unitCost: p.unitCost,
      reorderLevel: p.reorderLevel,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
