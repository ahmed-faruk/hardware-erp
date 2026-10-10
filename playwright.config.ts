import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

/** Local Supabase (public URL and anon key only) so the built app can sign in and sync during e2e. */
function localSupabase(): Record<string, string> {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    };
  }
  try {
    const out = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pick = (k: string): string => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out)?.[1] ?? '';
    return { VITE_SUPABASE_URL: pick('API_URL'), VITE_SUPABASE_ANON_KEY: pick('ANON_KEY') };
  } catch {
    return { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'unavailable' };
  }
}

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: localSupabase(),
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // `npm run perf` only: heavy (20,000 products), never part of the normal e2e runs
    ...(process.env.PERF
      ? [{ name: 'perf', testDir: 'tests/perf', use: { ...devices['Desktop Chrome'] } }]
      : []),
  ],
});
