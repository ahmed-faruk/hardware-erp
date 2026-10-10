import { describe, expect, it } from 'vitest';

import { buildHeaders, supabaseOrigins } from './headers';

describe('_headers', () => {
  it('allows only this app and the Supabase project', () => {
    const h = buildHeaders('https://abc123.supabase.co');
    expect(h).toContain("default-src 'self'");
    expect(h).toContain("connect-src 'self' https://abc123.supabase.co wss://abc123.supabase.co");
    expect(h).toContain("script-src 'self';");
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toContain("object-src 'none'");
    expect(h).toContain('X-Content-Type-Options: nosniff');
    expect(h).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(h).not.toMatch(/script-src[^;]*unsafe/);
  });
  it('caches the service worker and index.html never, hashed assets forever', () => {
    const h = buildHeaders(undefined);
    expect(h).toMatch(/\/sw\.js\n {2}Cache-Control: no-cache/);
    expect(h).toMatch(/\/index\.html\n {2}Cache-Control: no-cache/);
    expect(h).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  });
  it('works for a local http project and without any project', () => {
    expect(supabaseOrigins('http://127.0.0.1:54321')).toEqual([
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins('not a url')).toEqual([]);
    expect(buildHeaders(undefined)).toContain("connect-src 'self';");
  });
});
