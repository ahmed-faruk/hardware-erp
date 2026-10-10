/** Injectable clock: tests replace `clock.now`. */
export const clock = { now: (): Date => new Date() };

export const nowIso = (): string => clock.now().toISOString();

/** UUID v7: 48-bit unix ms + random bits (RFC 9562). */
export function uuidv7(ms: number = clock.now().getTime()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const SETTING_NAMESPACE = '5b0f1f0e-3c7a-4e55-9d4a-1c2f6e8a9b30';

/** UUID v5 (SHA-1, RFC 4122) so the same name always gives the same id on every device. */
export async function uuid5(name: string, namespace: string = SETTING_NAMESPACE): Promise<string> {
  const ns = Uint8Array.from(namespace.replace(/-/g, '').match(/../g) ?? [], (h) => parseInt(h, 16));
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One setting row per company and key, with the same id everywhere, so two managers editing a key merge instead of colliding. */
export const settingId = (companyId: string, key: string): Promise<string> => uuid5(`${companyId}:${key}`);
