import { invoiceProfit, type ProfitReturnLine, type ProfitSaleLine } from '@/domain/profit';

import type { HanafyDB } from './schema';

/** Profit of each sales invoice (after its posted returns), for the invoices on screen. Showing voided ones as none is the caller's job. */
export async function invoiceProfits(db: HanafyDB, invoiceIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (invoiceIds.length === 0) return out;
  const lines = (await db.salesInvoiceLines.where('invoiceId').anyOf(invoiceIds).toArray()).filter(
    (l) => !l.deletedAt,
  );
  const returns = (await db.salesReturns.where('originalInvoiceId').anyOf(invoiceIds).toArray()).filter(
    (r) => r.status === 'posted' && !r.deletedAt,
  );
  const returnLines =
    returns.length > 0
      ? (
          await db.salesReturnLines
            .where('returnId')
            .anyOf(returns.map((r) => r.id))
            .toArray()
        ).filter((l) => !l.deletedAt)
      : [];
  const invoiceOfReturn = new Map(returns.map((r) => [r.id, r.originalInvoiceId as string] as const));
  const soldBy = new Map<string, ProfitSaleLine[]>();
  for (const l of lines) {
    const row: ProfitSaleLine = {
      id: l.id,
      qty: Number(l.qty) || 0,
      unitFactor: Number(l.unitFactor) || 1000,
      netAmount: Number(l.netAmount) || 0,
      allocDiscount: Number(l.allocDiscount) || 0,
      unitCost: Number(l.unitCost) || 0,
    };
    soldBy.set(l.invoiceId, [...(soldBy.get(l.invoiceId) ?? []), row]);
  }
  const backBy = new Map<string, ProfitReturnLine[]>();
  for (const l of returnLines) {
    const invoiceId = invoiceOfReturn.get(l.returnId as string);
    if (!invoiceId) continue;
    const row: ProfitReturnLine = {
      originalLineId: (l.originalLineId as string | null) ?? null,
      qty: Number(l.qty) || 0,
      netAmount: Number(l.netAmount) || 0,
      unitCost: Number(l.unitCost) || 0,
    };
    backBy.set(invoiceId, [...(backBy.get(invoiceId) ?? []), row]);
  }
  for (const id of invoiceIds) out.set(id, invoiceProfit(soldBy.get(id) ?? [], backBy.get(id) ?? []));
  return out;
}
