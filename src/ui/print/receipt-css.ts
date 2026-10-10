export type Paper = '58' | '80';

/** Printable width: 58 mm paper prints 48 mm, 80 mm paper prints 72 mm (skill receipt-printing §1). Black only, no backgrounds. */
export function receiptCss(paper: Paper, fontFaces = ''): string {
  const width = paper === '80' ? '72mm' : '48mm';
  return `${fontFaces}
@page { size: ${paper}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { width: ${width}; margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: Cairo, Tahoma, Arial, sans-serif; font-size: 11pt; line-height: 1.35; font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.shop { font-size: 14pt; font-weight: 700; }
.small { font-size: 9pt; }
.banner { margin: 2mm auto; padding: 1mm 4mm; border: 0.5mm solid #000; display: block; width: max-content; font-weight: 700; font-size: 13pt; }
.rule { border: 0; border-top: 0.3mm dashed #000; margin: 2mm 0; }
.row { display: flex; justify-content: space-between; gap: 2mm; }
.line { margin-bottom: 1.5mm; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.num { direction: ltr; unicode-bidi: plaintext; white-space: nowrap; }
.total { font-size: 16pt; font-weight: 700; }
.barcode { display: block; width: 100%; height: 12mm; margin: 1mm 0; }
.id { direction: ltr; text-align: center; font-size: 9pt; }
.no-print { display: none; }
@media print { .no-print { display: none; } }
`;
}
