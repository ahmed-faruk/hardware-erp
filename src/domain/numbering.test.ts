import { describe, expect, it } from 'vitest';

import { formatDocNumber, parseDocNumber } from './numbering';

describe('document numbers', () => {
  it('formats with a 6-digit sequence', () => {
    expect(formatDocNumber('K1', 'INV', 245)).toBe('K1-INV-000245');
  });
  it('round-trips', () => {
    expect(parseDocNumber('K1-RET-000007')).toEqual({ devicePrefix: 'K1', type: 'RET', seq: 7 });
  });
  it('rejects bad input', () => {
    expect(parseDocNumber('K1-XXX-000007')).toBeNull();
    expect(parseDocNumber('garbage')).toBeNull();
    expect(() => formatDocNumber('K1', 'INV', 0)).toThrow();
    expect(() => formatDocNumber('k 1', 'INV', 1)).toThrow();
  });
});
