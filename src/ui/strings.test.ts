import { describe, expect, it } from 'vitest';

import { strings } from '@/ui/strings.ar';

describe('strings', () => {
  it('has the app name', () => {
    expect(strings.appName).not.toBe('');
  });
});
