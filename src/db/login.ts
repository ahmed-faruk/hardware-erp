import type { HanafyDB } from './schema';

const ITERATIONS = 210_000;
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

interface Verifier {
  workerId: string;
  salt: string;
  hash: string;
}

const key = (username: string): string => `login:${username.trim().toLowerCase()}`;

/**
 * What lets a worker who logged in before on this device log in again without the internet: a salted hash of the password,
 * kept in this device's own settings. It is never synced; the server holds the real (bcrypt) hash and never sends it.
 */
export async function saveVerifier(
  db: HanafyDB,
  username: string,
  workerId: string,
  password: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const value: Verifier = { workerId, salt: b64(salt), hash: await derive(password, salt) };
  await db.deviceSettings.put({ key: key(username), value });
}

/** The worker id when the password matches the saved verifier, otherwise null. */
export async function checkVerifier(
  db: HanafyDB,
  username: string,
  password: string,
): Promise<string | null> {
  const v = (await db.deviceSettings.get(key(username)))?.value as Verifier | undefined;
  if (!v) return null;
  return (await derive(password, unb64(v.salt))) === v.hash ? v.workerId : null;
}

export const hasVerifier = async (db: HanafyDB, username: string): Promise<boolean> =>
  !!(await db.deviceSettings.get(key(username)));
