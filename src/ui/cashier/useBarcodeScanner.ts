import { useEffect, useRef } from 'react';

/** A USB scanner types its digits very fast and ends with Enter. Keys closer than this belong to one scan (docs: skill pos-ui-low-literacy §4). */
export const BURST_MS = 30;
const MIN_LENGTH = 3;

/** Pure part, so it can be tested: feeds one key at a time and returns the finished code on Enter, else null. */
export class ScanBuffer {
  private chars = '';
  private last = 0;
  /** true while the keys so far look like a scanner (fast), so the caller can stop them reaching a text field */
  fast = false;

  push(key: string, nowMs: number): string | null {
    if (key === 'Enter') {
      const code = this.chars;
      const wasFast = this.fast;
      this.reset();
      return wasFast && code.length >= MIN_LENGTH ? code : null;
    }
    if (key.length !== 1) return null;
    this.fast = this.chars.length === 0 ? false : nowMs - this.last <= BURST_MS;
    if (this.chars.length > 0 && !this.fast) this.chars = '';
    this.chars += key;
    this.last = nowMs;
    if (this.chars.length >= 2 && nowMs - this.last <= BURST_MS) this.fast = true;
    return null;
  }

  reset(): void {
    this.chars = '';
    this.fast = false;
  }
}

/** Calls `onScan` with a scanned code even when no field is focused. Typing by hand is never mistaken for a scan. */
export function useBarcodeScanner(onScan: (code: string) => void): void {
  const buffer = useRef(new ScanBuffer());
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'TEXTAREA' ||
        (target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'search');
      if (typing) return buffer.current.reset();
      const code = buffer.current.push(e.key, performance.now());
      if (code) {
        e.preventDefault();
        if (target?.tagName === 'INPUT') (target as HTMLInputElement).value = '';
        handler.current(code);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
