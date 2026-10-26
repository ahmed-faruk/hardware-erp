export type DigitStyle = 'latn' | 'arab';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Digit style setting (docs/DESIGN_SYSTEM.md §3): `latn` keeps 123, `arab` shows ١٢٣ with the Arabic decimal and thousands signs. */
export function localizeDigits(text: string, style: DigitStyle): string {
  if (style === 'latn') return text;
  return text
    .replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] as string)
    .replace(/\./g, '٫')
    .replace(/,/g, '٬');
}

/** The most notes of one denomination a cashier can enter at shift close. */
export const MAX_COUNT = 9999;

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** A count typed by the cashier: Western or Arabic-Indic digits, at most 4; empty is 0; anything else is null (ignored). */
export function parseCount(text: string): number | null {
  const western = text
    .replace(/\s/g, '')
    .replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)));
  if (western === '') return 0;
  if (!/^[0-9]{1,4}$/.test(western)) return null;
  return Number(western);
}
