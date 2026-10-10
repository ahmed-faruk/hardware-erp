import type { HanafyDB } from './schema';
import type { Product, ProductUnit } from './types';

export interface Found {
  product: Product;
  /** set when the code belongs to a pack unit (carton, roll...) */
  unit: ProductUnit | null;
}

const sellable = (p: Product | undefined): p is Product =>
  !!p && p.active && !p.deletedAt && p.type !== undefined;

/** Exact barcode (or product code) -> the product and, for a pack barcode, that unit. Unknown or switched-off -> null. */
export async function findByBarcode(db: HanafyDB, code: string): Promise<Found | null> {
  const clean = code.trim();
  if (!clean) return null;
  const row = (await db.barcodes.where('code').equals(clean).toArray()).find((b) => !b.deletedAt);
  if (row) {
    const product = await db.products.get(row.productId);
    if (!sellable(product)) return null;
    const unit = row.productUnitId ? ((await db.productUnits.get(row.productUnitId)) ?? null) : null;
    return { product, unit: unit && !unit.deletedAt ? unit : null };
  }
  const bySku = (await db.products.where('sku').equals(clean).toArray()).find(sellable);
  return bySku ? { product: bySku, unit: null } : null;
}
