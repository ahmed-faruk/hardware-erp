/** EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('12 digits needed');
  const sum = [...first12].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export const isEan13 = (code: string): boolean =>
  /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

/**
 * A shop-made barcode for a product that has none: `990` + 9 digits + the check digit. The prefix is far from the scale-label
 * prefix (2) and from the numbers a supplier prints, so it can stand next to real barcodes. `random` gives a number in [0, 1).
 */
export function makeInternalBarcode(random: () => number): string {
  const body = `990${String(Math.floor(random() * 1_000_000_000)).padStart(9, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}
