import { describe, expect, it } from 'vitest';

import { ean13Check, parseScaleBarcode } from './scale';

/** builds a valid scale code: 2 + 0 + PLU(5) + value(5) + check */
const code = (plu: string, value: string, head = '20'): string => {
  const body = `${head}${plu}${value}`;
  return body + ean13Check(body);
};

describe('EAN-13 check digit', () => {
  it('matches a known code', () => {
    expect(ean13Check('400638133393')).toBe('1');
  });
});

describe('parseScaleBarcode', () => {
  it('weight mode: PLU and grams', () => {
    expect(parseScaleBarcode(code('00123', '01250'), { prefix: '2', mode: 'weight' })).toEqual({
      plu: '00123',
      grams: 1250,
    });
  });
  it('price mode: PLU and piasters', () => {
    expect(parseScaleBarcode(code('00123', '04575'), { prefix: '2', mode: 'price' })).toEqual({
      plu: '00123',
      pricePiasters: 4575,
    });
  });
  it('refuses a wrong checksum, a wrong prefix, a wrong length and non-digits', () => {
    const good = code('00123', '01250');
    const bad = good.slice(0, 12) + String((Number(good[12]) + 1) % 10);
    expect(parseScaleBarcode(bad, { prefix: '2', mode: 'weight' })).toBeNull();
    expect(parseScaleBarcode(code('00123', '01250', '30'), { prefix: '2', mode: 'weight' })).toBeNull();
    expect(parseScaleBarcode('123', { prefix: '2', mode: 'weight' })).toBeNull();
    expect(parseScaleBarcode('20abcde012508', { prefix: '2', mode: 'weight' })).toBeNull();
  });
  it('a two-digit prefix works', () => {
    expect(parseScaleBarcode(code('00007', '00500', '27'), { prefix: '27', mode: 'weight' })).toEqual({
      plu: '00007',
      grams: 500,
    });
  });
});
