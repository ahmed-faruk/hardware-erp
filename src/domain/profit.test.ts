import { describe, expect, it } from 'vitest';

import { invoiceProfit, lineCost } from './profit';

const sold = (
  id: string,
  qty: number,
  unitFactor: number,
  netAmount: number,
  allocDiscount: number,
  unitCost: number,
) => ({
  id,
  qty,
  unitFactor,
  netAmount,
  allocDiscount,
  unitCost,
});

describe('invoice profit', () => {
  it('a simple line: net minus cost', () => {
    expect(invoiceProfit([sold('a', 2000, 1000, 3000, 0, 1000)], [])).toBe(1000);
  });
  it('a carton line and its share of the invoice discount', () => {
    expect(invoiceProfit([sold('p', 1000, 12000, 20000, 1000, 1000)], [])).toBe(7000);
  });
  it('several lines add up', () => {
    expect(
      invoiceProfit([sold('a', 2000, 1000, 3000, 0, 1000), sold('p', 1000, 12000, 20000, 1000, 1000)], []),
    ).toBe(8000);
  });
  it('a returned part takes its revenue and its cost back', () => {
    const lines = [sold('a', 2000, 1000, 3000, 0, 1000)];
    expect(invoiceProfit(lines, [{ originalLineId: 'a', qty: 1000, netAmount: 1500, unitCost: 1000 }])).toBe(
      500,
    );
  });
  it('a returned carton uses the carton factor of its original line', () => {
    const lines = [sold('p', 2000, 12000, 40000, 0, 1000)];
    expect(invoiceProfit(lines, [{ originalLineId: 'p', qty: 1000, netAmount: 20000, unitCost: 1000 }])).toBe(
      8000,
    );
  });
  it('a return line whose original line is unknown counts in base units', () => {
    expect(invoiceProfit([], [{ originalLineId: null, qty: 1000, netAmount: 1500, unitCost: 1000 }])).toBe(
      -500,
    );
  });
  it('a sale below cost is a negative profit; no lines is 0', () => {
    expect(invoiceProfit([sold('a', 1000, 1000, 500, 0, 1000)], [])).toBe(-500);
    expect(invoiceProfit([], [])).toBe(0);
  });
  it('the cost is rounded half up like the server', () => {
    expect(lineCost(333, 1000, 1000)).toBe(333);
    expect(lineCost(333, 1500, 1000)).toBe(500);
  });
});
