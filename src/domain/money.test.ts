import { describe, expect, it } from 'vitest';

import { formatMoney, formatQty, mulDivRound, toMilli, toPiasters } from './money';

describe('toPiasters', () => {
  it.each([
    ['125.50', 12550],
    ['125.5', 12550],
    ['125', 12500],
    ['0.05', 5],
    ['0', 0],
    ['-3.25', -325],
  ])('parses %s', (input, expected) => {
    expect(toPiasters(input)).toEqual({ ok: true, value: expected });
  });
  it.each(['', 'abc', '1.234', '1,5', '1e3', '.', '12.'])('rejects %j', (input) => {
    expect(toPiasters(input).ok).toBe(false);
  });
});

describe('toMilli', () => {
  it.each([
    ['1', 1000],
    ['2.5', 2500],
    ['0.125', 125],
  ])('parses %s', (input, expected) => {
    expect(toMilli(input)).toEqual({ ok: true, value: expected });
  });
  it('rejects more than 3 decimals', () => {
    expect(toMilli('0.0001').ok).toBe(false);
  });
});

describe('format', () => {
  it('formats money', () => {
    expect(formatMoney(12550)).toBe('125.50');
    expect(formatMoney(5)).toBe('0.05');
    expect(formatMoney(-325)).toBe('-3.25');
  });
  it('formats qty trimming zeros', () => {
    expect(formatQty(1000)).toBe('1');
    expect(formatQty(2500)).toBe('2.5');
    expect(formatQty(125)).toBe('0.125');
  });
});

describe('mulDivRound', () => {
  it('rounds half up', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(5, 1, 10)).toBe(1);
    expect(mulDivRound(1250, 3, 1000)).toBe(4);
  });
  it('rounds half away from zero for negatives', () => {
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
    expect(mulDivRound(-1, 1, 3)).toBe(0);
  });
});
