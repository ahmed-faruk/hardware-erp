import { describe, expect, it } from 'vitest';

import { applyCashRounding, breakChange, DEFAULT_DENOMINATIONS, validatePayments } from './payments';

describe('validatePayments', () => {
  it('accepts exact split payments', () => {
    const r = validatePayments(
      10000,
      [
        { method: 'cash', amount: 6000 },
        { method: 'card', amount: 4000, reference: '1234' },
      ],
      null,
    );
    expect(r.ok).toBe(true);
  });
  it('rejects when the sum differs from the total', () => {
    const r = validatePayments(10000, [{ method: 'cash', amount: 9000 }], null);
    expect(r).toMatchObject({ ok: false, code: 'PAYMENTS_MISMATCH' });
  });
  it('allows cash tendered above its share and returns change', () => {
    const r = validatePayments(10000, [{ method: 'cash', amount: 10000, tendered: 20000 }], null);
    expect(r).toMatchObject({ ok: true, change: 10000 });
  });
  it('rejects tendered below the cash share', () => {
    const r = validatePayments(10000, [{ method: 'cash', amount: 10000, tendered: 9000 }], null);
    expect(r).toMatchObject({ ok: false, code: 'TENDERED_TOO_LOW' });
  });
  it('credit needs a customer', () => {
    expect(validatePayments(500, [{ method: 'credit', amount: 500 }], null)).toMatchObject({
      ok: false,
      code: 'CUSTOMER_REQUIRED',
    });
    expect(validatePayments(500, [{ method: 'credit', amount: 500 }], 'c1').ok).toBe(true);
  });
  it('card and instapay need a reference', () => {
    expect(validatePayments(500, [{ method: 'card', amount: 500 }], null)).toMatchObject({
      ok: false,
      code: 'REFERENCE_REQUIRED',
    });
    expect(validatePayments(500, [{ method: 'instapay', amount: 500 }], null)).toMatchObject({
      ok: false,
      code: 'REFERENCE_REQUIRED',
    });
  });
  it('rejects zero or negative amounts', () => {
    expect(
      validatePayments(
        500,
        [
          { method: 'cash', amount: 0 },
          { method: 'cash', amount: 500 },
        ],
        null,
      ).ok,
    ).toBe(false);
  });
});

describe('applyCashRounding', () => {
  it.each([
    [1010, 0, 1010],
    [1010, 25, 1000],
    [1015, 25, 1025],
    [1037, 25, 1025],
    [1025, 50, 1050],
    [1024, 50, 1000],
  ])('rounds %i by %i -> %i', (amount, step, expected) => {
    expect(applyCashRounding(amount, step as 0 | 25 | 50).rounded).toBe(expected);
  });
  it('reports the difference', () => {
    expect(applyCashRounding(1037, 25)).toEqual({ rounded: 1025, difference: -12 });
  });
});

describe('breakChange', () => {
  it('breaks 137.75 into notes and coins', () => {
    expect(breakChange(13775, DEFAULT_DENOMINATIONS)).toEqual({
      parts: [
        { value: 10000, count: 1 },
        { value: 2000, count: 1 },
        { value: 1000, count: 1 },
        { value: 500, count: 1 },
        { value: 100, count: 2 },
        { value: 50, count: 1 },
        { value: 25, count: 1 },
      ],
      remainder: 0,
    });
  });
  it('reports a remainder smaller than the smallest coin', () => {
    expect(breakChange(13, DEFAULT_DENOMINATIONS)).toEqual({ parts: [], remainder: 13 });
  });
  it('returns nothing for zero', () => {
    expect(breakChange(0, DEFAULT_DENOMINATIONS)).toEqual({ parts: [], remainder: 0 });
  });
});
