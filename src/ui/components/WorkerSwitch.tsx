import { strings } from '../strings.ar';
import { cx } from '../cx';

import styles from './WorkerSwitch.module.css';

export interface WorkerChoice {
  id: string;
  name: string;
  role: 'cashier' | 'storekeeper' | 'manager';
}

export interface WorkerSwitchProps {
  workers: WorkerChoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Grid of workers (initial on a color) instead of typing a username. */
export function WorkerSwitch({ workers, selectedId, onSelect }: WorkerSwitchProps) {
  return (
    <ul className={styles.grid}>
      {workers.map((w, i) => (
        <li key={w.id}>
          <button
            type="button"
            className={cx(styles.worker, w.id === selectedId && styles.selected)}
            onClick={() => onSelect(w.id)}
            aria-pressed={w.id === selectedId}
          >
            <span
              className={styles.avatar}
              style={{ background: `var(--cat-${(i % 8) + 1})` }}
              aria-hidden="true"
            >
              {[...w.name][0]}
            </span>
            <span className={styles.name}>{w.name}</span>
            <span className={styles.role}>{strings.roles[w.role]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
