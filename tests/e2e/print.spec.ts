import { expect, test } from '@playwright/test';

import { buildReceipt, type ReceiptInput } from '../../src/domain/receipt';
import { renderReceiptHtml } from '../../src/ui/print/render';

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

const pages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test.describe('receipt printing (Chromium print engine)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'page.pdf is Chromium only');

  for (const paper of ['80', '58'] as const) {
    test(`a short ${paper} mm receipt is one page and nothing is cut at the edge`, async ({ page }) => {
      await page.setContent(renderReceiptHtml(buildReceipt(base), paper));
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ width: `${paper}mm`, printBackground: false, preferCSSPageSize: true });
      expect(pages(pdf)).toBe(1);
      const cut = await page.evaluate(() => {
        const limit = document.body.getBoundingClientRect().right + 1;
        return [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((e) => e.getBoundingClientRect().right > limit)
          .map((e) => e.className || e.tagName);
      });
      expect(cut).toEqual([]);
    });
  }

  test('30 lines with very long names wrap inside the paper and keep every line', async ({ page }) => {
    const lines = Array.from({ length: 30 }, (_, i) => ({
      name: `صنف طويل جدا جدا رقم ${i} `.repeat(4),
      qtyMilli: 1000,
      unitPrice: 12345 + i,
      lineDiscount: 0,
      netAmount: 12345 + i,
      allocDiscount: 0,
    }));
    const total = lines.reduce((a, l) => a + l.netAmount, 0);
    await page.setContent(
      renderReceiptHtml(buildReceipt({ ...base, lines, invoice: { ...base.invoice, total } }), '58'),
    );
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('.line').count()).toBe(30);
    const cut = await page.evaluate(() => {
      const limit = document.body.getBoundingClientRect().right + 1;
      return [...document.querySelectorAll<HTMLElement>('body *')].filter(
        (e) => e.getBoundingClientRect().right > limit,
      ).length;
    });
    expect(cut).toBe(0);
    await page.pdf({ width: '58mm', preferCSSPageSize: true }); // must render without error
  });
});
