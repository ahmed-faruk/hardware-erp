import { useEffect, useState } from 'react';

import { play } from '../sound';
import { cx } from '../cx';

import { NumPad } from './NumPad';

import styles from './PinPad.module.css';

export const MIN_PIN = 6;
const MAX_PIN = 12;

export interface PinPadProps {
  /** resolves true when the PIN was accepted; false shakes and clears */
  onSubmit: (pin: string) => Promise<boolean>;
  disabled?: boolean;
}

/** PIN entry: dots + number pad, also works with the keyboard (digits, Backspace, Enter). Wrong PIN = shake + error tone. */
export function PinPad({ onSubmit, disabled }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string): Promise<void> => {
    if (value.length < MIN_PIN || busy || disabled) return;
    setBusy(true);
    const ok = await onSubmit(value);
    setBusy(false);
    if (!ok) {
      play('error');
      setShake(true);
      setPin('');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < MAX_PIN ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') void submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.dots, shake && styles.shake)}
        onAnimationEnd={() => setShake(false)}
        aria-hidden="true"
        data-testid="pin-dots"
      >
        {Array.from({ length: Math.max(MIN_PIN, pin.length) }, (_, i) => (
          <span key={i} className={cx(styles.dot, i < pin.length && styles.filled)} />
        ))}
      </div>
      <NumPad
        onDigit={(d) => setPin((p) => (p.length < MAX_PIN ? p + d : p))}
        onBackspace={() => setPin((p) => p.slice(0, -1))}
        onOk={() => void submit(pin)}
        okDisabled={pin.length < MIN_PIN || busy || disabled}
      />
    </div>
  );
}
