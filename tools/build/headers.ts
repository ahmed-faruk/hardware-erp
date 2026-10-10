// Cloudflare Pages `_headers`, generated at build time so the CSP names the right Supabase project per environment
// (skill ci-cd-deploy §4, docs/SECURITY.md §5).

/** `https://abc.supabase.co` -> the https and wss origins; a local http URL gets http and ws. */
export function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const secure = u.protocol === 'https:';
    return [`${secure ? 'https' : 'http'}://${u.host}`, `${secure ? 'wss' : 'ws'}://${u.host}`];
  } catch {
    return [];
  }
}

export function buildHeaders(supabaseUrl: string | undefined): string {
  const [http, ws] = supabaseOrigins(supabaseUrl);
  const api = [http, ws].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${http ? ` ${http}` : ''}`,
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    "font-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
