import { describe, expect, it } from 'vitest';

import { parseHash, toHash } from './router';

describe('router', () => {
  it('parses a hash into segments', () => {
    expect(parseHash('#/products/42')).toEqual(['products', '42']);
    expect(parseHash('')).toEqual([]);
    expect(parseHash('#/')).toEqual([]);
  });
  it('round-trips segments with special characters', () => {
    const segments = ['products', 'a b/ü'];
    expect(parseHash(toHash(segments))).toEqual(segments);
  });
});
