import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

describe('toCsv', () => {
  it('starts with a BOM so Excel reads Arabic, and ends rows with CRLF', () => {
    const out = toCsv([
      ['اليوم', 'المبلغ'],
      ['2026-10-01', 150.5],
    ]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿اليوم,المبلغ\r\n2026-10-01,150.5');
  });
  it('quotes commas, quotes and new lines', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny']])).toBe('﻿"a,b","say ""hi""","x\ny"');
  });
  it('defuses spreadsheet formulas in text, but keeps negative numbers', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@x', -5]])).toBe("﻿'=SUM(A1),'+1,'-2,'@x,-5");
  });
});
