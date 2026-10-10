import type { Piasters } from './money';

export interface ShiftReportInput {
  openingFloat: Piasters;
  /** payments of the sales invoices of this shift */
  salesPayments: { method: string; amount: Piasters }[];
  /** every cash movement of this shift on the drawer (sales +, refunds −, collections +, expenses −, transfers −, voids ∓) */
  cashMovements: { docType: string; amount: Piasters }[];
  returnsTotal: Piasters;
  returnsCount: number;
  voidsCount: number;
  noSaleCount: number;
  collections: { method: string; amount: Piasters }[];
  /** what the cashier counted; null while the shift is still open (X report) */
  counted: Piasters | null;
}

export interface ShiftReport {
  openingFloat: Piasters;
  salesByMethod: Record<string, Piasters>;
  salesTotal: Piasters;
  returnsTotal: Piasters;
  returnsCount: number;
  voidsCount: number;
  noSaleCount: number;
  collectionsByMethod: Record<string, Piasters>;
  expenses: Piasters;
  transfersOut: Piasters;
  expected: Piasters;
  counted: Piasters | null;
  variance: Piasters | null;
}

const group = (rows: { method: string; amount: Piasters }[]): Record<string, Piasters> => {
  const out: Record<string, Piasters> = {};
  for (const r of rows) out[r.method] = (out[r.method] ?? 0) + r.amount;
  return out;
};
const sumDoc = (rows: ShiftReportInput['cashMovements'], docType: string): Piasters =>
  rows.filter((r) => r.docType === docType).reduce((a, r) => a + r.amount, 0);

/** FIN-04: X (counted = null, any time) and Z (after the blind count). Pure: the caller gathers the rows. */
export function buildShiftReport(input: ShiftReportInput): ShiftReport {
  const salesByMethod = group(input.salesPayments);
  const expected = input.openingFloat + input.cashMovements.reduce((a, m) => a + m.amount, 0);
  return {
    openingFloat: input.openingFloat,
    salesByMethod,
    salesTotal: Object.values(salesByMethod).reduce((a, v) => a + v, 0),
    returnsTotal: input.returnsTotal,
    returnsCount: input.returnsCount,
    voidsCount: input.voidsCount,
    noSaleCount: input.noSaleCount,
    collectionsByMethod: group(input.collections),
    expenses: -sumDoc(input.cashMovements, 'expense'),
    transfersOut: -sumDoc(input.cashMovements, 'cash_transfer'),
    expected,
    counted: input.counted,
    variance: input.counted === null ? null : input.counted - expected,
  };
}
