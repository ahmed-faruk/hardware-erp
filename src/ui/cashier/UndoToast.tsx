import { Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { strings } from '../strings.ar';

import styles from './UndoToast.module.css';

export const UNDO_SECONDS = 5;

export interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
}

/** Undo instead of "are you sure?": the action already happened, this takes it back for 5 seconds (UX-10). */
export function UndoToast({ message, onUndo, onExpire }: UndoToastProps) {
  const [left, setLeft] = useState(UNDO_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) onExpire();
  }, [left, onExpire]);
  return (
    <div className={styles.toast} role="status" data-testid="undo-toast">
      <span>{message}</span>
      <button type="button" className={styles.undo} onClick={onUndo} aria-label={strings.sell.undo}>
        <Undo2 size={28} aria-hidden="true" />
        <span className={styles.ring}>{left}</span>
      </button>
    </div>
  );
}
