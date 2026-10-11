import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState, type ReactElement } from 'react';

import { useServices, useSession } from '@/app/session';
import { approveWithPin } from '@/db/commands/approval';
import { workerAccess } from '@/db/permissions';
import type { Action } from '@/domain/permissions';

import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { PinPad } from '../components/PinPad';
import { WorkerSwitch } from '../components/WorkerSwitch';
import { strings } from '../strings.ar';

import styles from './dialogs.module.css';

function ApprovalBody({ action, onApproved }: { action: Action; onApproved: (token: string) => void }) {
  const { db } = useServices();
  const { context } = useSession();
  // anyone whose own permissions give him this action outright can approve it, not only managers
  const managers = useLiveQuery(async () => {
    const all = (await db.workers.toArray()).filter((w) => w.active && !w.deletedAt && w.pinHash);
    const allowed = await Promise.all(all.map(async (w) => (await workerAccess(db, w, action)) === 'yes'));
    return all.filter((_, i) => allowed[i]);
  }, [db, action]);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{strings.sell.pickManager}</p>
      {managers && managers.length === 0 && <BigAlert tone="warn" word={strings.login.noWorkers} />}
      <WorkerSwitch workers={managers ?? []} selectedId={selected} onSelect={setSelected} />
      {selected && context && (
        <PinPad
          onSubmit={async (pin) => {
            const r = await approveWithPin(context, selected, pin, action);
            setLocked(!r.ok && r.code === 'PIN_LOCKED');
            if (r.ok) onApproved(r.value.token);
            return r.ok;
          }}
        />
      )}
      {locked && <BigAlert tone="danger" word={strings.login.locked} />}
    </div>
  );
}

export interface ApprovalDialogProps {
  action: Action | null;
  onApproved: (token: string) => void;
  onCancel: () => void;
}

/** A risky action asks for a manager's PIN on this device instead of a text confirmation (UX-09). */
export function ApprovalDialog({ action, onApproved, onCancel }: ApprovalDialogProps) {
  return (
    <Dialog title={strings.sell.approve} open={action !== null} onClose={onCancel}>
      {action && <ApprovalBody action={action} onApproved={onApproved} />}
    </Dialog>
  );
}

/** Promise style: `const token = await ask('discountOverLimit')` → a token, or null when the manager cancelled. */
export function useApproval(): { ask: (action: Action) => Promise<string | null>; dialog: ReactElement } {
  const [action, setAction] = useState<Action | null>(null);
  const resolver = useRef<((token: string | null) => void) | null>(null);
  const finish = useCallback((token: string | null) => {
    resolver.current?.(token);
    resolver.current = null;
    setAction(null);
  }, []);
  const ask = useCallback(
    (a: Action) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setAction(a);
      }),
    [],
  );
  return {
    ask,
    dialog: <ApprovalDialog action={action} onApproved={finish} onCancel={() => finish(null)} />,
  };
}
