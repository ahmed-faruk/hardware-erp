import { describe, expect, it } from 'vitest';

import { ean13CheckDigit, isEan13, makeInternalBarcode } from './barcode';

describe('barcodes made by the system', () => {
  it('computes the EAN-13 check digit (known codes)', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(isEan13('4006381333931')).toBe(true);
    expect(isEan13('4006381333932')).toBe(false);
    expect(isEan13('123')).toBe(false);
  });
  it('rejects anything but 12 digits', () => {
    expect(() => ean13CheckDigit('12345')).toThrow(RangeError);
    expect(() => ean13CheckDigit('40063813339x')).toThrow(RangeError);
  });
  it('an internal barcode is 13 digits, valid, starts with 990 and is padded', () => {
    const code = makeInternalBarcode(() => 0);
    expect(code).toMatch(/^990000000000\d$/);
    expect(isEan13(code)).toBe(true);
    const other = makeInternalBarcode(() => 0.999999999);
    expect(other.startsWith('990999999999')).toBe(true);
    expect(isEan13(other)).toBe(true);
  });
  it('different random numbers give different codes', () => {
    expect(makeInternalBarcode(() => 0.1)).not.toBe(makeInternalBarcode(() => 0.2));
  });
});
