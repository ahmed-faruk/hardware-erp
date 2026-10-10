import { describe, expect, it } from 'vitest';

import { normalizeArabic, tokenize } from './arabic';

describe('normalizeArabic', () => {
  it.each([
    ['أحمد', 'احمد'],
    ['إبراهيم', 'ابراهيم'],
    ['مدرسة', 'مدرسه'],
    ['على', 'علي'],
    ['مُحَمَّد', 'محمد'],
    ['كــوبشة', 'كوبشه'],
    ['١٢٣', '123'],
    ['  دهان   ABC ', 'دهان abc'],
  ])('%s -> %s', (input, expected) => expect(normalizeArabic(input)).toBe(expected));
});

describe('tokenize', () => {
  it('splits words, dedupes and keeps barcodes whole', () => {
    expect(tokenize('دهان أبيض 4 لتر - 6221')).toEqual(['دهان', 'ابيض', '4', 'لتر', '6221']);
    expect(tokenize('احمد أحمد')).toEqual(['احمد']);
    expect(tokenize('')).toEqual([]);
  });
});
