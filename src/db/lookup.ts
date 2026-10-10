import { mulDivRound } from '@/domain/money';
import { parseScaleBarcode } from '@/domain/scale';

import type { HanafyDB } from './schema';
import { loadSettings } from './settings';
import type { Product, ProductUnit } from './types';

export interface Found {
  product: Product;
  /** set when the code belongs to a pack unit (carton, roll...) */
  unit: ProductUnit | null;
  /** a scale label: the quantity it carries (milli-units), when it can be turned into one */
  qtyMilli?: number;
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
  if (bySku) return { product: bySku, unit: null };
  return findByScaleLabel(db, clean);
}

/** POS-04: when the scale setting is on, a 13-digit scale label finds its product by the PLU and carries the weight or the price. */
async function findByScaleLabel(db: HanafyDB, code: string): Promise<Found | null> {
  const settings = await loadSettings(db);
  if (!settings.scaleEnabled) return null;
  const label = parseScaleBarcode(code, { prefix: settings.scalePrefix, mode: settings.scaleMode });
  if (!label) return null;
  const product = (await db.products.toArray()).find(
    (p) => sellable(p) && (p.extraFields as { plu?: string | null } | null)?.plu === label.plu,
  );
  if (!product) return null;
  if ('grams' in label)
    return product.qtyDecimals === 3 && label.grams > 0
      ? { product, unit: null, qtyMilli: label.grams }
      : null;
  if (product.price <= 0 || label.pricePiasters <= 0) return null;
  return { product, unit: null, qtyMilli: mulDivRound(label.pricePiasters, 1000, product.price) };
}
