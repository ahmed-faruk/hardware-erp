import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'migration-data', 'tools'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // money never goes through floats (docs/CODE_STYLE.md §4)
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/domain/money.ts'],
    rules: {
      'no-restricted-properties': ['error', { property: 'toFixed', message: 'use formatMoney' }],
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'use toPiasters / toMilli' }],
    },
  },
  {
    // domain stays pure (docs/CODE_STYLE.md §7)
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@/db/*', '@/sync/*', '@/ui/*', 'react', 'dexie', '@supabase/*'] },
      ],
    },
  },
);
