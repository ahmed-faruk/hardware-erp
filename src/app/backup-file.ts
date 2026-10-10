import { loadIdentity } from '@/app/device-setup';
import { nowIso } from '@/db/ids';
import type { HanafyDB } from '@/db/schema';
import { saveDeviceSetting } from '@/db/settings';
import { exportBackup } from '@/sync/backup';

/** `hanafy-<devicePrefix>-<yyyymmdd-HHMM>.hanafybak`, Cairo time. */
export function backupFilename(prefix: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `hanafy-${prefix}-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.hanafybak`;
}

/** Saves the bytes through the browser's download (a Blob and a temporary link). */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** BAK-01: encrypted backup of this device, downloaded and remembered as the last one. */
export async function runBackup(db: HanafyDB, passphrase: string): Promise<string> {
  const identity = await loadIdentity(db);
  const bytes = await exportBackup(db, passphrase);
  const name = backupFilename(identity?.prefix ?? 'DEV');
  downloadBytes(bytes, name);
  await saveDeviceSetting(db, 'lastBackupAt', nowIso());
  return name;
}
