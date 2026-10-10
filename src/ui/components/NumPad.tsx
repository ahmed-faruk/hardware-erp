import { Check, Delete } from 'lucide-react';

import { strings } from '../strings.ar';

import styles from './NumPad.module.css';

export interface NumPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onOk: () => void;
  okDisabled?: boolean;
  /** show a decimal key (only for units that allow fractions) */
  decimal?: boolean;
}

/** 3x4 grid of 64 px keys (docs/DESIGN_SYSTEM.md §6). Digits are always Western on the keys; display formatting is separate. */
export function NumPad({ onDigit, onBackspace, onOk, okDisabled, decimal }: NumPadProps) {
  const digit = (d: string) => (
    <button key={d} type="button" className={styles.key} onClick={() => onDigit(d)} data-testid={`key-${d}`}>
      {d}
    </button>
  );
  return (
    <div className={styles.pad} role="group" aria-label={strings.login.pin} dir="ltr">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit)}
      <button
        type="button"
        className={styles.key}
        onClick={onBackspace}
        aria-label={strings.common.back}
        data-testid="key-back"
      >
        <Delete size={24} aria-hidden="true" />
      </button>
      {decimal ? digit('.') : digit('0')}
      {decimal ? digit('0') : null}
      <button
        type="button"
        className={`${styles.key} ${styles.ok}`}
        onClick={onOk}
        disabled={okDisabled}
        aria-label={strings.common.save}
        data-testid="key-ok"
      >
        <Check size={28} aria-hidden="true" />
      </button>
    </div>
  );
}
