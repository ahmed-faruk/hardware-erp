import { mulDivRound } from '@/domain/money';
import type { SoldReturned } from '@/domain/returns';

import type { HanafyDB } from './schema';

/**
 * Sold and returned quantity (base milli-units) per product, from the posted invoices and returns this device has.
 * Pass the products you care about, or nothing for every product that was ever sold.
 */
export async function loadSoldReturned(
  db: HanafyDB,
  productIds?: Iterable<string>,
): Promise<Map<string, SoldReturned>> {
  const wanted = productIds ? new Set(productIds) : null;
  const take = (id: unknown): id is string => typeof id === 'string' && (!wanted || wanted.has(id));
  const soldLines = await db.salesInvoiceLines.filter((l) => take(l.productId)).toArray();
  const invoices = await db.salesInvoices.bulkGet([...new Set(soldLines.map((l) => l.invoiceId))]);
  const posted = new Set(invoices.filter((i) => i?.status === 'posted').map((i) => i!.id));
  const out = new Map<string, SoldReturned>();
  const bucket = (id: string): SoldReturned => {
    const b = out.get(id) ?? { sold: 0, returned: 0 };
    out.set(id, b);
    return b;
  };
  for (const l of soldLines) {
    if (!posted.has(l.invoiceId)) continue;
    bucket(l.productId as string).sold += mulDivRound(l.qty, l.unitFactor, 1000);
  }
  const returnLines = await db.salesReturnLines.filter((l) => take(l.productId)).toArray();
  const returns = await db.salesReturns.bulkGet([...new Set(returnLines.map((l) => l.returnId as string))]);
  const goodReturns = new Set(returns.filter((r) => r?.status === 'posted').map((r) => r!.id));
  const originals = await db.salesInvoiceLines.bulkGet(
    returnLines.map((l) => (l.originalLineId as string | null) ?? ''),
  );
  returnLines.forEach((l, i) => {
    if (!goodReturns.has(l.returnId as string)) return;
    const factor = originals[i]?.unitFactor ?? 1000;
    bucket(l.productId as string).returned += mulDivRound(l.qty as number, factor, 1000);
  });
  return out;
}

/** Return lines that point at the given invoice lines, counting only returns that are still posted (a voided return gives its quantity back). */
export async function postedReturnLines(db: HanafyDB, originalLineIds: string[]) {
  const lines = await db.salesReturnLines.where('originalLineId').anyOf(originalLineIds).toArray();
  const returns = await db.salesReturns.bulkGet([...new Set(lines.map((l) => l.returnId as string))]);
  const posted = new Set(returns.filter((r) => r?.status === 'posted').map((r) => r!.id));
  return lines.filter((l) => posted.has(l.returnId as string));
}
