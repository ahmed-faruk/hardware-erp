import { execFileSync } from 'node:child_process';

import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

function localSupabase(): Record<string, string> {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const pick = (k: string) => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out)?.[1] ?? '';
  return { VITE_SUPABASE_URL: pick('API_URL'), VITE_SUPABASE_ANON_KEY: pick('ANON_KEY') };
}

export default {
  tests: ['tests/agent/**/*.e2e.ts'],
  timeout: 180_000,
  workers: 1,
  cache: { dir: '.e2e/cache' },
  targets: [
    {
      name: 'chromium',
      engine: web({ browser: 'chromium', viewport: { width: 1366, height: 768 } }),
      app: {
        url: 'http://127.0.0.1:4174',
        command: {
          executable: 'sh',
          args: ['-c', 'npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort'],
          env: localSupabase(),
          startupTimeout: 240_000,
        },
      },
    },
  ],
} satisfies E2EConfig;
