/** One sold line as the profit needs it (a sales invoice line). */
export interface ProfitSaleLine {
  id: string;
  qty: number;
  unitFactor: number;
  netAmount: number;
  allocDiscount: number;
  unitCost: number;
}

/** One returned line as the profit needs it (a sales return line). */
export interface ProfitReturnLine {
  originalLineId: string | null;
  qty: number;
  netAmount: number;
  unitCost: number;
}

/** Cost of a quantity: unit cost per base unit x quantity (milli) x unit factor (milli), rounded half up like the server. */
export const lineCost = (unitCost: number, qtyMilli: number, factorMilli: number): number =>
  Math.round((unitCost * qtyMilli * factorMilli) / 1_000_000);

/**
 * One invoice's profit, the way the profit report counts it (owner decision 2026-10-25): every line's net amount less its share
 * of the invoice discount less its cost; the lines that came back on posted returns take their revenue and cost back off.
 */
export function invoiceProfit(lines: ProfitSaleLine[], returned: ProfitReturnLine[]): number {
  const factorOf = new Map(lines.map((l) => [l.id, l.unitFactor] as const));
  let profit = 0;
  for (const l of lines) profit += l.netAmount - l.allocDiscount - lineCost(l.unitCost, l.qty, l.unitFactor);
  for (const r of returned) {
    const factor = (r.originalLineId ? factorOf.get(r.originalLineId) : undefined) ?? 1000;
    profit -= r.netAmount - lineCost(r.unitCost, r.qty, factor);
  }
  return profit;
}
