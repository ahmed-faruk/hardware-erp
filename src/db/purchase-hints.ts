import { costPerBase } from '@/domain/purchase';
import { mulDivRound } from '@/domain/money';

import type { HanafyDB } from './schema';

export interface LineHints {
  /** what the last posted purchase of this product cost per base unit (any supplier), null if it was never bought here */
  lastCostPerBase: number | null;
  /** the product's current (moving average) cost per base unit */
  currentCost: number;
  /** stock on hand, base milli-units, over every warehouse */
  stockMilli: number;
}

/** The numbers shown under a purchase line: last purchase price, current cost, stock. */
export async function lineHints(db: HanafyDB, productId: string): Promise<LineHints> {
  const product = await db.products.get(productId);
  const invoices = (await db.purchaseInvoices.filter((i) => i.status === 'posted').toArray()).sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt),
  );
  let lastCostPerBase: number | null = null;
  if (invoices.length > 0) {
    const lines = await db.purchaseInvoiceLines
      .where('invoiceId')
      .anyOf(invoices.map((i) => i.id))
      .filter((l) => l.productId === productId)
      .toArray();
    for (const inv of invoices) {
      const line = lines.find((l) => l.invoiceId === inv.id);
      if (line) {
        const base = mulDivRound(line.qty as number, line.unitFactor as number, 1000);
        lastCostPerBase = base > 0 ? costPerBase(line.netAmount as number, base) : null;
        break;
      }
    }
  }
  const stockMilli = (await db.stockBalances.filter((b) => b.productId === productId).toArray()).reduce(
    (a, b) => a + b.qty,
    0,
  );
  return { lastCostPerBase, currentCost: product?.unitCost ?? 0, stockMilli };
}

/** A per-base cost shown for a line in a pack unit (factor in milli: 12000 = 12 pieces) is the pack's cost. */
export const costForUnit = (perBase: number, factorMilli: number): number =>
  mulDivRound(perBase, factorMilli, 1000);
