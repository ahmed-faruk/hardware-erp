import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { strings } from '../strings.ar';

import styles from './Dialog.module.css';

export interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Native <dialog>: focus trap, Esc and backdrop come from the browser (Firefox 98+, Chrome, Safari 15.4+). */
export function Dialog({ title, open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-label={title} onClose={onClose}>
      <header className={styles.header}>
        <h2>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={strings.common.close}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>{open && children}</div>
    </dialog>
  );
}
