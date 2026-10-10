import { describe, expect, it } from 'vitest';

import { formatMoney } from '@/domain/money';
import { buildReceipt, type ReceiptInput } from '@/domain/receipt';

import { renderNoSaleHtml, renderReceiptHtml } from './render';

const base: ReceiptInput = {
  shop: { name: 'مركز حنفي للتلوين', phone: '0100 000 0000', address: 'القاهرة', footer: 'شكرًا لتعاملكم' },
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
      name: 'دهان أبيض 4 لتر',
      qtyMilli: 2000,
      unitPrice: 5000,
      lineDiscount: 0,
      netAmount: 10000,
      allocDiscount: 0,
    },
    {
      name: 'سلك كهرباء',
      qtyMilli: 2500,
      unitPrice: 2000,
      lineDiscount: 0,
      netAmount: 5000,
      allocDiscount: 0,
    },
  ],
  payments: [{ method: 'cash', amount: 15000, reference: null }],
  customer: null,
  copy: false,
  digits: 'latn',
};

describe('Receipt HTML', () => {
  it('80 mm cash sale (snapshot)', () => {
    expect(renderReceiptHtml(buildReceipt(base), '80')).toMatchSnapshot();
  });
  it('58 mm width and page size', () => {
    const html = renderReceiptHtml(buildReceipt(base), '58');
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('width: 48mm');
    expect(renderReceiptHtml(buildReceipt(base), '80')).toContain('width: 72mm');
  });
  it('credit sale with customer balances and a copy banner (snapshot)', () => {
    const data = buildReceipt({
      ...base,
      payments: [
        { method: 'cash', amount: 5000, reference: null },
        { method: 'credit', amount: 10000, reference: null },
      ],
      customer: { name: 'عميل تجريبي', balanceBefore: 20000 },
      copy: true,
    });
    expect(renderReceiptHtml(data, '80')).toMatchSnapshot();
  });
  it('30 lines with long names keeps every line and every digit', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({
      name: `صنف طويل جدا جدا ${i} `.repeat(4),
      qtyMilli: 1000,
      unitPrice: 123 + i,
      lineDiscount: 0,
      netAmount: 123 + i,
      allocDiscount: 0,
    }));
    const total = lines.reduce((a, l) => a + l.netAmount, 0);
    const html = renderReceiptHtml(
      buildReceipt({ ...base, lines, invoice: { ...base.invoice, total } }),
      '58',
    );
    expect(html.match(/class="line"/g)).toHaveLength(30);
    expect(html).toContain(formatMoney(total));
    expect(html).toContain('overflow-wrap: anywhere');
  });
  it('embeds the invoice number as a barcode and as text, and is black only', () => {
    const html = renderReceiptHtml(buildReceipt(base), '80');
    expect(html).toContain('aria-label="K1-INV-000245"');
    expect(html).toContain('<rect');
    const backgrounds = [...html.matchAll(/background:\s*([^;]+);/g)].map((m) => m[1]);
    expect(backgrounds.every((b) => b === '#fff')).toBe(true);
  });
  it('card payments print their reference', () => {
    const html = renderReceiptHtml(
      buildReceipt({ ...base, payments: [{ method: 'card', amount: 15000, reference: '1234' }] }),
      '80',
    );
    expect(html).toContain('1234');
  });
  it('no-sale slip carries the reason and the worker', () => {
    const html = renderNoSaleHtml(
      'مركز حنفي للتلوين',
      { workerName: 'عبدالله', reason: 'change', at: '2026-10-10T09:30:00.000Z' },
      '10/10/2026 12:30',
      '80',
    );
    expect(html).toContain('فتح الدرج بدون بيع');
    expect(html).toContain('عبدالله');
    expect(html).toContain('فكة لعميل');
  });
});
