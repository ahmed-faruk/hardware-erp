import { mulDivRound } from '@/domain/money';

import type { HanafyDB } from './schema';

/** The latest posted purchase line of a product from a supplier: its value and its quantity in base units. */
export async function lastPurchaseLine(
  db: HanafyDB,
  supplierId: string,
  productId: string,
): Promise<{ net: number; baseQtyMilli: number } | null> {
  const invoices = (
    await db.purchaseInvoices.filter((i) => i.supplierId === supplierId && i.status === 'posted').toArray()
  ).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  if (invoices.length === 0) return null;
  const lines = await db.purchaseInvoiceLines
    .where('invoiceId')
    .anyOf(invoices.map((i) => i.id))
    .filter((l) => l.productId === productId)
    .toArray();
  for (const inv of invoices) {
    const line = lines.find((l) => l.invoiceId === inv.id);
    if (line)
      return {
        net: line.netAmount as number,
        baseQtyMilli: mulDivRound(line.qty as number, line.unitFactor as number, 1000),
      };
  }
  return null;
}
