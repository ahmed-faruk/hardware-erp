export type ScaleMode = 'weight' | 'price';

/** EAN-13 check digit of the first 12 digits. */
export function ean13Check(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * POS-04: a scale label. 13 digits: prefix (1–2 digits, start of the first two), PLU in digits 3–7, value in digits 8–12
 * (grams in weight mode, piasters in price mode), then the EAN-13 check digit. Anything else is not a scale code.
 */
export function parseScaleBarcode(
  code: string,
  options: { prefix: string; mode: ScaleMode },
): { plu: string; grams: number } | { plu: string; pricePiasters: number } | null {
  if (!/^\d{13}$/.test(code) || !code.startsWith(options.prefix)) return null;
  if (ean13Check(code.slice(0, 12)) !== code[12]) return null;
  const plu = code.slice(2, 7);
  const value = Number(code.slice(7, 12));
  return options.mode === 'weight' ? { plu, grams: value } : { plu, pricePiasters: value };
}
