import { describe, expect, it } from 'vitest';

import {
  cairoToIso,
  legacyId,
  mapPaymentLabel,
  normalizeArabic,
  parseDate,
  parseDiscount,
  parseMoney,
  parseQty,
  parseSalePayments,
  uuid5,
} from './parse.ts';

describe('parseMoney', () => {
  it.each([
    ['EGP 1,234.50', 123450],
    ['EGP 12.00', 1200],
    ['-EGP 5.00', -500],
    ['EGP -5.00', -500],
    ['EGP 0.00', 0],
    ['EGP 0.005', 1],
    ['EGP 590.1', 59010],
  ])('%s', (input, expected) => expect(parseMoney(input)).toBe(expected));
  it.each(['', 'abc', 'EGP', 'hello EGP 5.00'])('rejects %j', (input) =>
    expect(parseMoney(input)).toBeNull(),
  );
});

describe('parseQty', () => {
  it.each([
    ['76.00', 76000],
    ['1.00 [stock]', 1000],
    ['-2.50', -2500],
    ['2.00 x 12.00', 24000],
    ['0.50 x 3.00', 1500],
    ['-1.00 x 12.00', -12000],
  ])('%s', (input, expected) => expect(parseQty(input)).toBe(expected));
  it('rejects text', () => expect(parseQty('abc')).toBeNull());
});

describe('parseDiscount', () => {
  it('handles none, percent and money', () => {
    expect(parseDiscount('0.00%')).toEqual({ kind: 'none' });
    expect(parseDiscount('')).toEqual({ kind: 'none' });
    expect(parseDiscount('12.50%')).toEqual({ kind: 'percentBp', bp: 1250 });
    expect(parseDiscount('EGP 5.00')).toEqual({ kind: 'fixed', piasters: 500 });
    expect(parseDiscount('EGP 0.00')).toEqual({ kind: 'none' });
    expect(parseDiscount('nonsense')).toBeNull();
  });
});

describe('dates (Africa/Cairo)', () => {
  it('uses the right offset in winter and summer', () => {
    expect(parseDate('15/01/2026')).toBe('2026-01-15T10:00:00.000Z'); // UTC+2
    expect(parseDate('15/07/2026')).toBe('2026-07-15T09:00:00.000Z'); // UTC+3 (DST)
    expect(parseDate('29/06/2017')).toBe('2017-06-29T10:00:00.000Z'); // no DST in 2017
  });
  it('parses a 12-hour time', () => {
    expect(parseDate('13/02/2021 02:17:55 am')).toBe('2021-02-13T00:17:55.000Z');
    expect(parseDate('13/02/2021 02:17:55 pm')).toBe('2021-02-13T12:17:55.000Z');
    expect(parseDate('13/02/2021 12:05:00 am')).toBe('2021-02-12T22:05:00.000Z');
  });
  it('rejects garbage', () => {
    expect(parseDate('2026-01-15')).toBeNull();
    expect(parseDate('32/01/2026')).toBeNull();
    expect(cairoToIso(2026, 1, 1, 0, 0, 0)).toBe('2025-12-31T22:00:00.000Z');
  });
});

describe('ids', () => {
  it('uuid5 is the RFC 4122 test vector', () => {
    expect(uuid5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
  it('legacyId is stable and distinct per kind', () => {
    expect(legacyId('sale', 1)).toBe(legacyId('sale', '1'));
    expect(legacyId('sale', 1)).not.toBe(legacyId('item', 1));
    expect(legacyId('sale', 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('text and payments', () => {
  it('normalises Arabic for matching', () => {
    expect(normalizeArabic('أحمد  إبراهيم')).toBe(normalizeArabic('احمد ابراهيم'));
    expect(normalizeArabic('مدرسة')).toBe(normalizeArabic('مدرسه'));
  });
  it('maps labels', () => {
    expect(mapPaymentLabel('نقدى')).toEqual({ method: 'cash', known: true });
    expect(mapPaymentLabel('مستحق')).toEqual({ method: 'credit', known: true });
    expect(mapPaymentLabel('بطاقة خصم')).toEqual({ method: 'card', known: true });
    expect(mapPaymentLabel('Cash')).toEqual({ method: 'cash', known: true });
    expect(mapPaymentLabel('شيك')).toEqual({ method: 'other', known: false });
  });
  it('splits sale payments', () => {
    expect(parseSalePayments('نقدى 590.00, مستحق 100.00')).toMatchObject([
      { method: 'cash', amount: 59000 },
      { method: 'credit', amount: 10000 },
    ]);
    expect(parseSalePayments('نقدى 12.00')).toHaveLength(1);
    expect(parseSalePayments('')).toEqual([]);
    expect(parseSalePayments('بطاقة إئتمانية 5.50')[0]).toMatchObject({ method: 'card', amount: 550 });
  });
});
