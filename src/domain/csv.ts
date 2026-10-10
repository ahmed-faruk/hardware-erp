/** RPT-01: rows to a CSV file Excel opens correctly (BOM for Arabic, CRLF). Text that starts like a formula is defused. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    if (typeof v === 'number') return String(v);
    const text = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
