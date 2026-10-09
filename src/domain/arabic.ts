/** Arabic matching form: strips tashkeel and tatweel, folds alef/ya/ta-marbuta, Arabic digits -> Western, lowercases Latin. Matching only. */
export function normalizeArabic(text: string): string {
  return String(text ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Search tokens: normalized words and digit groups (barcodes stay whole). */
export function tokenize(text: string): string[] {
  return [
    ...new Set(
      normalizeArabic(text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    ),
  ];
}
