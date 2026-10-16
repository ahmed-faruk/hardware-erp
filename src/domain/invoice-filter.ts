/** Everything the invoice search screens can narrow by. Empty = no limit on that field. */
export interface InvoiceFilter {
  /** digits or part of the number, e.g. "000245" or "K1-INV" */
  number: string;
  /** Cairo calendar days, yyyy-mm-dd, both included */
  from: string;
  to: string;
  /** part of the customer's (sale) or supplier's (purchase) name */
  party: string;
  status: '' | 'posted' | 'voided' | 'returned';
  method: '' | 'cash' | 'credit' | 'card' | 'instapay' | 'wallet' | 'owner' | 'other';
  /** piasters, null = no limit */
  minAmount: number | null;
  maxAmount: number | null;
  /** product ids the invoice must contain (any of them); resolved from a name or a barcode by the screen */
  productIds: string[] | null;
  workerId: string;
  deviceId: string;
  shiftId: string;
}

export const EMPTY_FILTER: InvoiceFilter = {
  number: '',
  from: '',
  to: '',
  party: '',
  status: '',
  method: '',
  minAmount: null,
  maxAmount: null,
  productIds: null,
  workerId: '',
  deviceId: '',
  shiftId: '',
};

/** One invoice with everything the filter looks at, already worked out. */
export interface InvoiceRow {
  id: string;
  number: string;
  /** Cairo day, yyyy-mm-dd */
  day: string;
  partyName: string;
  status: 'posted' | 'voided';
  /** a posted return points at it */
  hasReturn: boolean;
  methods: string[];
  total: number;
  productIds: string[];
  workerId: string | null;
  deviceId: string | null;
  shiftId: string | null;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** The filters are all ANDed. A voided invoice counts as «voided» only; «returned» means a posted return exists. */
export function matchesInvoice(row: InvoiceRow, f: InvoiceFilter): boolean {
  if (f.number.trim() && !row.number.toLowerCase().includes(norm(f.number))) return false;
  if (f.from && row.day < f.from) return false;
  if (f.to && row.day > f.to) return false;
  if (f.party.trim() && !row.partyName.toLowerCase().includes(norm(f.party))) return false;
  if (f.status === 'posted' && row.status !== 'posted') return false;
  if (f.status === 'voided' && row.status !== 'voided') return false;
  if (f.status === 'returned' && !(row.status === 'posted' && row.hasReturn)) return false;
  if (f.method && !row.methods.includes(f.method)) return false;
  if (f.minAmount !== null && row.total < f.minAmount) return false;
  if (f.maxAmount !== null && row.total > f.maxAmount) return false;
  if (f.productIds && !f.productIds.some((id) => row.productIds.includes(id))) return false;
  if (f.workerId && row.workerId !== f.workerId) return false;
  if (f.deviceId && row.deviceId !== f.deviceId) return false;
  if (f.shiftId && row.shiftId !== f.shiftId) return false;
  return true;
}

/** True when no field narrows anything (the default view). */
export const isEmptyFilter = (f: InvoiceFilter): boolean =>
  JSON.stringify({ ...f, productIds: f.productIds }) === JSON.stringify(EMPTY_FILTER);

/** The UTC instant of 00:00 Cairo time of a Cairo day (the shop's day starts there, with or without summer time). */
export function cairoDayStartIso(day: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  for (const hours of [2, 3]) {
    const t = Date.UTC(y, m - 1, d) - hours * 3_600_000;
    if (fmt.format(new Date(t)) === day && fmt.format(new Date(t - 1)) !== day)
      return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d) - 3 * 3_600_000).toISOString();
}
