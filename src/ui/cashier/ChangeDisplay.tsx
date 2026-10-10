import { breakChange, DEFAULT_DENOMINATIONS } from '@/domain/payments';
import { formatMoney } from '@/domain/money';

import { strings } from '../strings.ar';

import styles from './ChangeDisplay.module.css';

const NOTE_COLORS: Record<number, string> = {
  20000: '#7c3aed',
  10000: '#2563eb',
  5000: '#0891b2',
  2000: '#16a34a',
  1000: '#ea580c',
  500: '#b45309',
};

/** The change as the notes and coins to hand back (UX-07): stylised drawings in a note's own color, never photos of real money. */
export function ChangeDisplay({ change, digits }: { change: number; digits: (text: string) => string }) {
  const { parts, remainder } = breakChange(change, DEFAULT_DENOMINATIONS);
  return (
    <div className={styles.wrap} data-testid="change-display">
      <div className={styles.label}>{strings.sell.change}</div>
      <div className={styles.amount}>{digits(formatMoney(change))}</div>
      <ul className={styles.parts}>
        {parts.map((p) => {
          const note = p.value >= 500;
          return (
            <li key={p.value} className={styles.part}>
              <span
                className={note ? styles.note : styles.coin}
                style={note ? { background: NOTE_COLORS[p.value] } : undefined}
                aria-hidden="true"
              >
                {digits(String(p.value / 100))}
              </span>
              <span className={styles.count}>{`× ${digits(String(p.count))}`}</span>
            </li>
          );
        })}
        {remainder > 0 && (
          <li className={styles.part}>
            <span className={styles.coin} aria-hidden="true">
              {digits(formatMoney(remainder))}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
