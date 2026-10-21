/**
 * Puts the cursor in a field, on a computer only: on a phone or tablet the keyboard would open over half the screen
 * (owner decision 2026-10-21).
 */
export function focusOnPc(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  if (window.matchMedia?.('(pointer: coarse)').matches) return;
  el.focus();
}
