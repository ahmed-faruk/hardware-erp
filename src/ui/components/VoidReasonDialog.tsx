import { Ban } from 'lucide-react';

import { VOID_REASONS } from '@/db/commands/returns';

import styles from '../cashier/dialogs.module.css';
import { strings } from '../strings.ar';

import { Dialog } from './Dialog';

/** The manager picks why a document is deleted from a fixed list: no typing, no "are you sure" (UX-09). */
export function VoidReasonDialog({
  open,
  onPick,
  onClose,
  title = strings.voidInvoice.title,
}: {
  open: boolean;
  onPick: (reason: (typeof VOID_REASONS)[number]) => void;
  onClose: () => void;
  title?: string;
}) {
  return (
    <Dialog title={title} open={open} onClose={onClose}>
      <div className={styles.reasons}>
        {VOID_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className={styles.reason}
            onClick={() => onPick(r)}
            data-testid={`void-reason-${r}`}
          >
            <Ban size={32} aria-hidden="true" />
            <span>{strings.voidInvoice.reasons[r]}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
