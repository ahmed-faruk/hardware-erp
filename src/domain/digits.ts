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
