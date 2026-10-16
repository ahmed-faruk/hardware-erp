import { describe, expect, it } from 'vitest';

import { cairoDaysBetween } from './returnWindow';

describe('cairoDaysBetween', () => {
  it('counts Cairo calendar days, not 24 h blocks', () => {
    // 23:30 UTC on the 1st is already the 2nd in Cairo (UTC+3 in October)
    expect(cairoDaysBetween('2026-10-01T23:30:00Z', '2026-10-02T10:00:00Z')).toBe(0);
    expect(cairoDaysBetween('2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z')).toBe(1);
  });
});
