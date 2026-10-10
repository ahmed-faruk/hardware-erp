import { describe, expect, it } from 'vitest';

import { localizeDigits } from './digits';

describe('localizeDigits', () => {
  it('keeps Western digits for latn', () => {
    expect(localizeDigits('1,275.50', 'latn')).toBe('1,275.50');
  });
  it('uses Arabic-Indic digits and separators for arab', () => {
    expect(localizeDigits('1275.50', 'arab')).toBe('١٢٧٥٫٥٠');
    expect(localizeDigits('K1-INV-000245', 'arab')).toBe('K١-INV-٠٠٠٢٤٥');
  });
});
