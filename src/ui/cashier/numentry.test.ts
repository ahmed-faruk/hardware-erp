import { describe, expect, it } from 'vitest';

import { pushKey } from './NumEntry';

describe('pushKey', () => {
  it('builds numbers digit by digit and drops a leading zero', () => {
    expect([...'125'].reduce((t, k) => pushKey(t, k, 2), '')).toBe('125');
    expect(pushKey('0', '5', 2)).toBe('5');
  });
  it('allows one dot and only the allowed decimals', () => {
    expect([...'12.505'].reduce((t, k) => pushKey(t, k, 2), '')).toBe('12.50');
    expect(pushKey('12.5', '.', 2)).toBe('12.5');
    expect(pushKey('', '.', 2)).toBe('0.');
    expect(pushKey('12', '.', 0)).toBe('12');
  });
  it('ignores anything that is not a digit or a dot, and caps the length', () => {
    expect(pushKey('1', 'a', 2)).toBe('1');
    expect(pushKey('123456789012', '3', 2)).toBe('123456789012');
  });
});
