import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { backupFilename } from '@/app/backup-file';
import { exportBackup, restoreBackup } from '@/sync/backup';

import { newDevice, seedCatalog } from './helpers';

describe('backup file', () => {
  it('names the file with the device prefix and Cairo date and time', () => {
    // 2026-10-10 21:30 UTC is 00:30 on the 11th in Cairo
    expect(backupFilename('K1', new Date('2026-10-10T21:30:00Z'))).toBe('hanafy-K1-20261011-0030.hanafybak');
  });

  it('a backup of a seeded device restores with the right passphrase and is refused with a wrong one', async () => {
    const ctx = newDevice('K1', 'manager');
    await seedCatalog(ctx);
    const bytes = await exportBackup(ctx.db, 'correct horse');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x48, 0x50, 0x42, 0x31]);
    expect(await restoreBackup(ctx.db, bytes, 'wrong pass')).toMatchObject({
      ok: false,
      code: 'BACKUP_WRONG_PASSPHRASE',
    });
    const ok = await restoreBackup(ctx.db, bytes, 'correct horse');
    expect(ok.ok).toBe(true);
  });
});
