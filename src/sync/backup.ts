import { SCHEMA_VERSION, type HanafyDB } from '@/db/schema';
import { nowIso } from '@/db/ids';
import { err, ok, type Result } from '@/domain/result';

const MAGIC = new Uint8Array([0x48, 0x50, 0x42, 0x31]); // "HPB1"
const PBKDF2_ITERATIONS = 210_000;

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** BAK-01: every table + schemaVersion + SHA-256, gzipped, then AES-GCM with a key derived from the manager passphrase. */
export async function exportBackup(db: HanafyDB, passphrase: string): Promise<Uint8Array> {
  const tables: Record<string, unknown[]> = {};
  for (const t of db.tables) tables[t.name] = await t.toArray();
  const payload = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(),
    sha256: await sha256(JSON.stringify(tables)),
    tables,
  });
  const gz = await pipe(new TextEncoder().encode(payload), new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await deriveKey(passphrase, salt),
      gz as BufferSource,
    ),
  );
  const out = new Uint8Array(MAGIC.length + 16 + 12 + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + 16);
  out.set(cipher, MAGIC.length + 28);
  return out;
}

/** Restore = upsert by primary key, so restoring twice (or onto a live DB) never duplicates anything. */
export async function restoreBackup(
  db: HanafyDB,
  data: Uint8Array,
  passphrase: string,
): Promise<Result<{ rows: number }>> {
  if (data.length < MAGIC.length + 28 || MAGIC.some((b, i) => data[i] !== b))
    return err('BACKUP_INVALID', 'ملف النسخة غير صحيح');
  const salt = data.slice(MAGIC.length, MAGIC.length + 16);
  const iv = data.slice(MAGIC.length + 16, MAGIC.length + 28);
  let gz: Uint8Array;
  try {
    gz = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await deriveKey(passphrase, salt),
        data.slice(MAGIC.length + 28),
      ),
    );
  } catch {
    return err('BACKUP_WRONG_PASSPHRASE', 'كلمة السر غلط');
  }
  const payload = JSON.parse(new TextDecoder().decode(await pipe(gz, new DecompressionStream('gzip')))) as {
    schemaVersion: number;
    sha256: string;
    tables: Record<string, unknown[]>;
  };
  if (payload.schemaVersion > SCHEMA_VERSION) return err('BACKUP_TOO_NEW', 'النسخة من إصدار أحدث');
  if ((await sha256(JSON.stringify(payload.tables))) !== payload.sha256)
    return err('BACKUP_CORRUPT', 'النسخة تالفة');
  let rows = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const [name, list] of Object.entries(payload.tables)) {
      await db.table(name).bulkPut(list);
      rows += list.length;
    }
  });
  return ok({ rows });
}

/** Asks the browser not to evict our data; false means the manager must be warned. */
export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}

/** Fraction of the quota used (0..1); alert the manager at 0.8. */
export async function storageUsage(): Promise<number | null> {
  const est = await navigator.storage?.estimate?.();
  return est?.usage !== undefined && est.quota ? est.usage / est.quota : null;
}
