import { describe, expect, it } from 'vitest';

import { shortcutFor } from './useShortcuts';

const key = (k: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
  shortcutFor({ key: k, shiftKey: false, ctrlKey: false, ...mods });

describe('shortcuts (prd-v2 §16.3)', () => {
  it('maps the default keys', () => {
    expect(key('F2')).toBe('search');
    expect(key('F4')).toBe('customer');
    expect(key('F8')).toBe('hold');
    expect(key('F8', { shiftKey: true })).toBe('held');
    expect(key('F9')).toBe('pay');
    expect(key('Enter', { ctrlKey: true })).toBe('finish');
    expect(key('Escape')).toBe('escape');
  });
  it('leaves browser keys and plain typing alone', () => {
    for (const k of ['F5', ' ', 'a', 'Enter', 'F11', 'F12']) expect(key(k)).toBeNull();
    expect(key('w', { ctrlKey: true })).toBeNull();
    expect(key('t', { ctrlKey: true })).toBeNull();
  });
});
