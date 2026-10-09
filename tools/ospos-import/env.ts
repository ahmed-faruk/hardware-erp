import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = fileURLToPath(new URL('./out/', import.meta.url));

/** Reads tools/ospos-import/.env.local (git-ignored) into process.env without overriding real env vars. */
export function loadEnv(): void {
  const file = fileURLToPath(new URL('./.env.local', import.meta.url));
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && process.env[m[1]] === undefined)
      process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
}

export function exportFile(): string {
  if (process.env.OSPOS_EXPORT_FILE) return process.env.OSPOS_EXPORT_FILE;
  const dir = `${ROOT}migration-data/`;
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^ospos-export-.*\.json$/.test(f))
        .sort()
    : [];
  const latest = files.at(-1);
  if (!latest) throw new Error('No migration-data/ospos-export-*.json found');
  return `${dir}${latest}`;
}

export interface Target {
  url: string;
  key: string;
  host: string;
  isLocal: boolean;
}

/** The service_role key is read ONLY here, from env / tools/ospos-import/.env.local, and never printed. */
export function target(confirm: string | undefined): Target {
  loadEnv();
  const url = process.env.TARGET_SUPABASE_URL;
  const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      'Set TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_ROLE_KEY in tools/ospos-import/.env.local',
    );
  const host = new URL(url).host;
  const isLocal = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (!isLocal && confirm !== host) {
    throw new Error(`Target is ${host}, not a local database. Re-run with --confirm ${host} to write there.`);
  }
  return { url, key, host, isLocal };
}
