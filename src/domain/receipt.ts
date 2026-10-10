import { localizeDigits, type DigitStyle } from './digits';
import { formatMoney, formatQty, type Milli, type Piasters } from './money';
import type { PayMethod } from './payments';

/** Everything a receipt prints, already formatted: the template only places it (skill receipt-printing §1-§2). */
export interface ReceiptInput {
  shop: { name: string; phone: string; address: string; footer: string };
  invoice: {
    number: string;
    issuedAt: string;
    total: Piasters;
    invoiceDiscount: Piasters;
    cashTendered: Piasters;
    changeDue: Piasters;
  };
  cashierName: string;
  lines: {
    name: string;
    qtyMilli: Milli;
    unitPrice: Piasters;
    lineDiscount: Piasters;
    netAmount: Piasters;
    allocDiscount: Piasters;
  }[];
  payments: { method: PayMethod; amount: Piasters; reference: string | null }[];
  /** the customer on a credit sale and their balance BEFORE this invoice */
  customer: { name: string; balanceBefore: Piasters } | null;
  copy: boolean;
  digits: DigitStyle;
}

export interface ReceiptData {
  shop: ReceiptInput['shop'];
  number: string;
  /** the plain number, for the barcode */
  barcodeValue: string;
  dateText: string;
  cashier: string;
  lines: { name: string; qty: string; unitPrice: string; total: string }[];
  discount: string | null;
  total: string;
  payments: { method: PayMethod; amount: string; reference: string | null }[];
  tendered: string | null;
  change: string | null;
  credit: { customer: string; previous: string; thisInvoice: string; now: string } | null;
  copy: boolean;
}

const cairoTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(', ', ' ');

export function buildReceipt(input: ReceiptInput): ReceiptData {
  const d = (text: string): string => localizeDigits(text, input.digits);
  const money = (p: Piasters): string => d(formatMoney(p));
  const discountTotal = input.lines.reduce((a, l) => a + l.lineDiscount, 0) + input.invoice.invoiceDiscount;
  const creditPaid = input.payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0);
  return {
    shop: input.shop,
    number: d(input.invoice.number),
    barcodeValue: input.invoice.number,
    dateText: d(cairoTime(input.invoice.issuedAt)),
    cashier: input.cashierName,
    lines: input.lines.map((l) => ({
      name: l.name,
      qty: d(formatQty(l.qtyMilli)),
      unitPrice: money(l.unitPrice),
      total: money(l.netAmount - l.allocDiscount),
    })),
    discount: discountTotal > 0 ? money(discountTotal) : null,
    total: money(input.invoice.total),
    payments: input.payments.map((p) => ({
      method: p.method,
      amount: money(p.amount),
      reference: p.reference,
    })),
    tendered: input.invoice.cashTendered > 0 ? money(input.invoice.cashTendered) : null,
    change: input.invoice.changeDue > 0 ? money(input.invoice.changeDue) : null,
    credit:
      input.customer && creditPaid > 0
        ? {
            customer: input.customer.name,
            previous: money(input.customer.balanceBefore),
            thisInvoice: money(creditPaid),
            now: money(input.customer.balanceBefore + creditPaid),
          }
        : null,
    copy: input.copy,
  };
}
