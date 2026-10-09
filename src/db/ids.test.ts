import { describe, expect, it } from 'vitest';

import { uuidv7 } from './ids';

describe('uuidv7', () => {
  it('has version 7 and the RFC variant', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('sorts by creation time', () => {
    const ids = [1_700_000_000_000, 1_700_000_000_001, 1_800_000_000_000].map((ms) => uuidv7(ms));
    expect([...ids].sort()).toEqual(ids);
  });
  it('is unique', () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
