import { describe, expect, it } from 'vitest';

import { localizeDigits, MAX_COUNT, parseCount } from './digits';

describe('localizeDigits', () => {
  it('keeps Western digits for latn', () => {
    expect(localizeDigits('1,275.50', 'latn')).toBe('1,275.50');
  });
  it('uses Arabic-Indic digits and separators for arab', () => {
    expect(localizeDigits('1275.50', 'arab')).toBe('١٢٧٥٫٥٠');
    expect(localizeDigits('K1-INV-000245', 'arab')).toBe('K١-INV-٠٠٠٢٤٥');
  });
});

describe('parseCount', () => {
  it('reads Western and Arabic-Indic digits, ignoring spaces', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('١٢')).toBe(12);
    expect(parseCount('۳')).toBe(3);
    expect(parseCount('1٢')).toBe(12);
    expect(parseCount(' 7 ')).toBe(7);
    expect(parseCount('0042')).toBe(42);
  });
  it('empty is 0; letters, signs, decimals and more than 4 digits are refused', () => {
    expect(parseCount('')).toBe(0);
    for (const bad of ['a', '-1', '1.5', '12345', '1e3', '+2']) expect(parseCount(bad)).toBeNull();
    expect(parseCount('9999')).toBe(MAX_COUNT);
  });
});
