import { mulDivRound, type Milli, type Piasters } from './money';

export type Discount = { kind: 'percentBp'; valueBp: number } | { kind: 'fixed'; value: Piasters };

export interface LineInput {
  qtyMilli: Milli;
  unitPrice: Piasters;
  discount?: Discount;
}

export interface LineResult {
  grossAmount: Piasters;
  discount: Piasters;
  netAmount: Piasters;
  allocatedInvoiceDiscount: Piasters;
  finalAmount: Piasters;
}

export interface InvoiceResult {
  lines: LineResult[];
  invoiceDiscount: Piasters;
  taxAmount: 0;
  total: Piasters;
}

function discountAmount(base: Piasters, d: Discount | null | undefined): Piasters {
  if (!d) return 0;
  if (d.kind === 'percentBp') {
    if (!Number.isInteger(d.valueBp) || d.valueBp < 0 || d.valueBp > 10000)
      throw new RangeError('percent must be integer basis points 0..10000');
    return mulDivRound(base, d.valueBp, 10000);
  }
  if (!Number.isInteger(d.value) || d.value < 0)
    throw new RangeError('fixed discount must be a non-negative integer');
  return d.value;
}

/** Spreads `amount` over `weights` proportionally; largest remainder, ties to the earlier line, sum is exact. */
function allocate(amount: Piasters, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || sum === 0) return weights.map(() => 0);
  const shares = weights.map((w, i) => ({
    i,
    floor: Math.floor((amount * w) / sum),
    rem: (amount * w) % sum,
  }));
  let left = amount - shares.reduce((a, s) => a + s.floor, 0);
  const order = [...shares].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const s of order) {
    if (left <= 0) break;
    s.floor += 1;
    left -= 1;
  }
  return shares.map((s) => s.floor);
}

/** Line and invoice totals in piasters. Rounds half-up once per line (docs: skill hardware-erp-domain §2). */
export function computeInvoice(lines: LineInput[], invoiceDiscount: Discount | null): InvoiceResult {
  const base = lines.map((l) => {
    const grossAmount = mulDivRound(l.qtyMilli, l.unitPrice, 1000);
    const discount = discountAmount(grossAmount, l.discount);
    if (discount > grossAmount) throw new RangeError('line discount exceeds the line amount');
    return { grossAmount, discount, netAmount: grossAmount - discount };
  });
  const netSum = base.reduce((a, l) => a + l.netAmount, 0);
  const invDisc = discountAmount(netSum, invoiceDiscount);
  if (invDisc > netSum) throw new RangeError('invoice discount exceeds the invoice amount');
  const alloc = allocate(
    invDisc,
    base.map((l) => l.netAmount),
  );
  const result = base.map((l, i) => {
    const allocatedInvoiceDiscount = alloc[i] ?? 0;
    return { ...l, allocatedInvoiceDiscount, finalAmount: l.netAmount - allocatedInvoiceDiscount };
  });
  return {
    lines: result,
    invoiceDiscount: invDisc,
    taxAmount: 0,
    total: result.reduce((a, l) => a + l.finalAmount, 0),
  };
}
