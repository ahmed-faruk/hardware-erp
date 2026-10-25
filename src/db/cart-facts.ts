import { lineHints } from './purchase-hints';
import type { HanafyDB } from './schema';

export interface CartFact {
  /** base milli-units on the shelf of the selling warehouse; null for a service */
  stockMilli: number | null;
  /** last purchase price per base unit; the product's own cost when it was never bought in this system (owner decision 2026-10-25) */
  costPerBase: number;
}

/** What the sell cart shows under each product: its stock in the selling warehouse and its last purchase price. */
export async function cartFacts(
  db: HanafyDB,
  productIds: string[],
  warehouseId: string | null,
): Promise<Map<string, CartFact>> {
  const out = new Map<string, CartFact>();
  for (const id of productIds) {
    const product = await db.products.get(id);
    if (!product) continue;
    const hints = await lineHints(db, id);
    const balance = warehouseId ? await db.stockBalances.get([id, warehouseId]) : undefined;
    out.set(id, {
      stockMilli: product.type === 'stock' ? (balance?.qty ?? 0) : null,
      costPerBase: hints.lastCostPerBase ?? product.unitCost,
    });
  }
  return out;
}
