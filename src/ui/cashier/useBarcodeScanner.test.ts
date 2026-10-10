import { describe, expect, it } from 'vitest';

import { ScanBuffer } from './useBarcodeScanner';

const feed = (b: ScanBuffer, keys: string, gap: number, start = 0): string | null => {
  let t = start;
  let out: string | null = null;
  for (const k of keys) {
    out = b.push(k, t) ?? out;
    t += gap;
  }
  return out;
};

describe('ScanBuffer', () => {
  it('a fast burst ending in Enter is a scan', () => {
    const b = new ScanBuffer();
    feed(b, '6221234', 10);
    expect(b.push('Enter', 80)).toBe('6221234');
  });
  it('typing by hand (slow keys) is never a scan', () => {
    const b = new ScanBuffer();
    feed(b, '6221234', 200);
    expect(b.push('Enter', 2000)).toBeNull();
  });
  it('a slow key restarts the code, so a stray key before a scan does not break it', () => {
    const b = new ScanBuffer();
    b.push('x', 0);
    feed(b, '99887766', 10, 1000);
    expect(b.push('Enter', 1100)).toBe('99887766');
  });
  it('too short a burst is ignored', () => {
    const b = new ScanBuffer();
    feed(b, '12', 5);
    expect(b.push('Enter', 20)).toBeNull();
  });
  it('two scans in a row work', () => {
    const b = new ScanBuffer();
    feed(b, '1111', 5);
    expect(b.push('Enter', 30)).toBe('1111');
    feed(b, '2222', 5, 500);
    expect(b.push('Enter', 540)).toBe('2222');
  });
});
