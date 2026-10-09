import type { Milli, Piasters } from './money';

export interface StockRow {
  productId: string;
  warehouseId: string;
  qtyMilli: Milli;
}
export interface PartyRow {
  partyType: 'customer' | 'supplier';
  partyId: string;
  amount: Piasters;
}
export interface CashRow {
  cashAccountId: string;
  amount: Piasters;
}

const sum = <T>(rows: T[], pick: (r: T) => number): number => rows.reduce((a, r) => a + pick(r), 0);

/** Balances are always derived from ledger rows, never stored as editable fields. */
export const stockBalance = (rows: StockRow[], productId: string, warehouseId: string): Milli =>
  sum(
    rows.filter((r) => r.productId === productId && r.warehouseId === warehouseId),
    (r) => r.qtyMilli,
  );

export const partyBalance = (rows: PartyRow[], partyType: PartyRow['partyType'], partyId: string): Piasters =>
  sum(
    rows.filter((r) => r.partyType === partyType && r.partyId === partyId),
    (r) => r.amount,
  );

export const cashBalance = (rows: CashRow[], cashAccountId: string): Piasters =>
  sum(
    rows.filter((r) => r.cashAccountId === cashAccountId),
    (r) => r.amount,
  );
