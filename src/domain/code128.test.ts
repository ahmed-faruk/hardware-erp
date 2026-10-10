import { describe, expect, it } from 'vitest';

import { code128B, PATTERNS } from './code128';

describe('Code 128 B', () => {
  it('has 107 patterns: 106 symbols of 11 modules and the 13-module stop', () => {
    expect(PATTERNS).toHaveLength(107);
    for (const p of PATTERNS.slice(0, 106)) expect([...p].reduce((a, d) => a + Number(d), 0)).toBe(11);
    expect([...(PATTERNS[106] as string)].reduce((a, d) => a + Number(d), 0)).toBe(13);
    expect(new Set(PATTERNS).size).toBe(107);
  });
  it('encodes "Hi" with start B, the characters, checksum 84 and stop', () => {
    expect(code128B('Hi').symbols).toEqual([104, 40, 73, 84, 106]);
  });
  it('module width is 11 per symbol plus the 2-module stop bar', () => {
    const b = code128B('K1-INV-000245');
    expect(b.symbols).toHaveLength(13 + 3);
    expect(b.modules).toBe((13 + 2) * 11 + 13);
  });
  it('bars alternate black and white starting with black', () => {
    const b = code128B('A');
    expect(b.bars[0]?.black).toBe(true);
    expect(b.bars.every((bar, i) => bar.black === (i % 2 === 0))).toBe(true);
    expect(b.bars.reduce((a, bar) => a + bar.width, 0)).toBe(b.modules);
  });
  it('rejects characters outside printable ASCII', () => {
    expect(() => code128B('عربي')).toThrow();
  });
});
