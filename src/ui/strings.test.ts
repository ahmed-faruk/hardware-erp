import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { strings } from './strings.ar';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('strings', () => {
  it('has the app name', () => {
    expect(strings.appName).not.toBe('');
  });
  it('keeps every Arabic word in strings.ar.ts (docs/CODE_STYLE.md §5)', () => {
    const offenders = ['src/ui', 'src/app']
      .flatMap(sourceFiles)
      .filter((f) => !f.endsWith('strings.ar.ts'))
      .filter((f) => /[؀-ۿ]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
