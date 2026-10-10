import { Download, Upload } from 'lucide-react';
import { useState } from 'react';

import { runBackup } from '@/app/backup-file';
import { useServices, useSession } from '@/app/session';
import { recordAudit } from '@/db/commands/audit';
import { saveDeviceSetting, type DeviceSettings } from '@/db/settings';
import { restoreBackup } from '@/sync/backup';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

const ERRORS: Record<string, string> = {
  BACKUP_INVALID: strings.backup.invalid,
  BACKUP_WRONG_PASSPHRASE: strings.backup.wrongPass,
  BACKUP_TOO_NEW: strings.backup.tooNew,
  BACKUP_CORRUPT: strings.backup.corrupt,
};

/** BAK-01/04: set the passphrase, download an encrypted backup now, or restore from a file. Manager screen only. */
export function BackupSection({ device }: { device: DeviceSettings }) {
  const { db } = useServices();
  const { context } = useSession();
  const [pass, setPass] = useState('');
  const [repeat, setRepeat] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; word: string } | null>(null);

  const savePass = async (): Promise<void> => {
    if (pass.length < 8) return setMessage({ tone: 'danger', word: strings.backup.short });
    if (pass !== repeat) return setMessage({ tone: 'danger', word: strings.backup.mismatch });
    await saveDeviceSetting(db, 'backupPassphrase', pass);
    setPass('');
    setRepeat('');
    setMessage({ tone: 'ok', word: strings.backup.saved });
  };
  const download = async (): Promise<void> => {
    if (!device.backupPassphrase) return setMessage({ tone: 'danger', word: strings.backup.needPass });
    await runBackup(db, device.backupPassphrase);
    setMessage({ tone: 'ok', word: strings.backup.done });
  };
  const restore = async (): Promise<void> => {
    if (!file || !context) return;
    const r = await restoreBackup(db, new Uint8Array(await file.arrayBuffer()), restorePass);
    if (!r.ok) return setMessage({ tone: 'danger', word: ERRORS[r.code] ?? strings.backup.invalid });
    await recordAudit(context, 'backup_restored', 'backup', null, { rows: r.value.rows });
    window.location.reload();
  };

  return (
    <div className={styles.section}>
      <h2>{strings.backup.title}</h2>
      <p data-testid="last-backup">
        {`${strings.backup.last}: ${device.lastBackupAt ? new Date(device.lastBackupAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : strings.backup.never}`}
      </p>
      <FormField label={strings.backup.passphrase}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="password"
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            data-testid="backup-pass"
          />
        )}
      </FormField>
      <FormField label={strings.backup.repeat}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            data-testid="backup-pass2"
          />
        )}
      </FormField>
      <div className={styles.actions}>
        <ActionButton label={strings.backup.save} onClick={() => void savePass()} testId="backup-save-pass" />
        <ActionButton
          label={strings.backup.download}
          icon={Download}
          variant="ok"
          onClick={() => void download()}
          testId="backup-download"
        />
      </div>
      <h2>{strings.backup.restore}</h2>
      <FormField label={strings.backup.restore}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="file"
            accept=".hanafybak"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="backup-file"
          />
        )}
      </FormField>
      <FormField label={strings.backup.passphrase}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="password"
            autoComplete="off"
            value={restorePass}
            onChange={(e) => setRestorePass(e.target.value)}
            data-testid="restore-pass"
          />
        )}
      </FormField>
      <div className={styles.actions}>
        <ActionButton
          label={strings.backup.restoreBtn}
          icon={Upload}
          variant="danger"
          disabled={!file || !restorePass}
          onClick={() => void restore()}
          testId="backup-restore"
        />
      </div>
      {message && <BigAlert tone={message.tone} word={message.word} sound={false} />}
    </div>
  );
}
