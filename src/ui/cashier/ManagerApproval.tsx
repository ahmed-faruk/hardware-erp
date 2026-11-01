import { useState } from 'react';

import { useServices } from '@/app/session';
import { checkVerifier } from '@/db/login';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import styles from './dialogs.module.css';

/** A manager types their own login on this device to let a cashier go past a limit (owner decision 2026-11-01). Checked offline. */
export function ManagerApproval({
  open,
  onCancel,
  onApproved,
}: {
  open: boolean;
  onCancel: () => void;
  onApproved: (managerId: string) => void;
}) {
  return (
    <Dialog title={strings.approval.title} open={open} onClose={onCancel}>
      <Body onApproved={onApproved} />
    </Dialog>
  );
}

function Body({ onApproved }: { onApproved: (managerId: string) => void }) {
  const { db } = useServices();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = async (): Promise<void> => {
    if (!username.trim() || !password) return;
    setBusy(true);
    const id = await checkVerifier(db, username, password);
    const worker = id ? await db.workers.get(id) : undefined;
    setBusy(false);
    if (worker && worker.role === 'manager' && worker.active && !worker.deletedAt) onApproved(worker.id);
    else setWrong(true);
  };
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{strings.approval.hint}</p>
      <FormField label={strings.approval.username}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="approve-username"
          />
        )}
      </FormField>
      <FormField label={strings.approval.password}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="password"
            dir="ltr"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void check();
            }}
            data-testid="approve-password"
          />
        )}
      </FormField>
      {wrong && <BigAlert tone="danger" word={strings.approval.wrong} />}
      <ActionButton
        big
        variant="ok"
        label={strings.approval.confirm}
        loading={busy}
        disabled={!username.trim() || !password}
        onClick={() => void check()}
        testId="approve-confirm"
      />
    </div>
  );
}
