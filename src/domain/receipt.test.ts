import { describe, expect, it } from 'vitest';

import { buildReceipt, type ReceiptInput } from './receipt';

const base: ReceiptInput = {
  shop: { name: 'مركز حنفي للتلوين', phone: '0100', address: 'القاهرة', footer: 'شكرًا' },
  invoice: {
    number: 'K1-INV-000245',
    issuedAt: '2026-10-10T09:30:00.000Z',
    total: 15000,
    invoiceDiscount: 0,
    cashTendered: 20000,
    changeDue: 5000,
  },
  cashierName: 'عبدالله',
  lines: [
    {
      name: 'دهان أبيض',
      qtyMilli: 2000,
      unitPrice: 5000,
      lineDiscount: 0,
      netAmount: 10000,
      allocDiscount: 0,
    },
    { name: 'سلك', qtyMilli: 2500, unitPrice: 2000, lineDiscount: 0, netAmount: 5000, allocDiscount: 0 },
  ],
  payments: [{ method: 'cash', amount: 15000, reference: null }],
  customer: null,
  copy: false,
  digits: 'latn',
};

describe('buildReceipt', () => {
  it('formats a cash sale', () => {
    const r = buildReceipt(base);
    expect(r.number).toBe('K1-INV-000245');
    expect(r.lines).toEqual([
      { name: 'دهان أبيض', qty: '2', unitPrice: '50.00', total: '100.00' },
      { name: 'سلك', qty: '2.5', unitPrice: '20.00', total: '50.00' },
    ]);
    expect(r.total).toBe('150.00');
    expect(r.tendered).toBe('200.00');
    expect(r.change).toBe('50.00');
    expect(r.payments).toEqual([{ method: 'cash', amount: '150.00', reference: null }]);
    expect(r.copy).toBe(false);
    expect(r.dateText).toMatch(/12:30|١٢:٣٠/); // Cairo is UTC+3 in October
  });
  it('line totals include the line discount and the share of the invoice discount', () => {
    const r = buildReceipt({
      ...base,
      invoice: { ...base.invoice, invoiceDiscount: 300, total: 14700 },
      lines: [
        { ...(base.lines[0] as ReceiptInput['lines'][number]), allocDiscount: 200 },
        { ...(base.lines[1] as ReceiptInput['lines'][number]), allocDiscount: 100 },
      ],
    });
    expect(r.lines.map((l) => l.total)).toEqual(['98.00', '49.00']);
    expect(r.discount).toBe('3.00');
    expect(r.total).toBe('147.00');
  });
  it('credit sale shows the customer with previous, this and new balance', () => {
    const r = buildReceipt({
      ...base,
      payments: [
        { method: 'cash', amount: 5000, reference: null },
        { method: 'credit', amount: 10000, reference: null },
      ],
      customer: { name: 'عميل', balanceBefore: 20000 },
    });
    expect(r.credit).toEqual({ customer: 'عميل', previous: '200.00', thisInvoice: '100.00', now: '300.00' });
  });
  it('a cash sale for a customer shows no credit block', () => {
    expect(buildReceipt({ ...base, customer: { name: 'عميل', balanceBefore: 0 } }).credit).toBeNull();
  });
  it('card payments keep their reference; reprints are marked copy', () => {
    const r = buildReceipt({
      ...base,
      payments: [{ method: 'card', amount: 15000, reference: '1234' }],
      copy: true,
    });
    expect(r.payments[0]).toEqual({ method: 'card', amount: '150.00', reference: '1234' });
    expect(r.copy).toBe(true);
  });
  it('uses Arabic-Indic digits when the device setting says so', () => {
    const r = buildReceipt({ ...base, digits: 'arab' });
    expect(r.total).toBe('١٥٠٫٠٠');
    expect(r.number).toBe('K١-INV-٠٠٠٢٤٥');
  });
  it('handles 30 lines and very long names without losing a line', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({
      name: `صنف طويل جدا جدا رقم ${i} `.repeat(3),
      qtyMilli: 1000,
      unitPrice: 100,
      lineDiscount: 0,
      netAmount: 100,
      allocDiscount: 0,
    }));
    const r = buildReceipt({ ...base, lines, invoice: { ...base.invoice, total: 3000 } });
    expect(r.lines).toHaveLength(30);
  });
});
