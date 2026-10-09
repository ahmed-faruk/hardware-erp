import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';

import { play } from '../sound';
import { cx } from '../cx';

import styles from './BigAlert.module.css';

export type AlertTone = 'ok' | 'danger' | 'warn';

const ICON: Record<AlertTone, LucideIcon> = { ok: CircleCheck, danger: CircleX, warn: TriangleAlert };

export interface BigAlertProps {
  tone: AlertTone;
  /** short word, never a paragraph */
  word: string;
  /** play the matching sound once when it appears */
  sound?: boolean;
}

/** Full-width band: icon + color + sound + a short word (color is never the only signal). */
export function BigAlert({ tone, word, sound = true }: BigAlertProps) {
  const Icon = ICON[tone];
  useEffect(() => {
    if (sound) play(tone === 'ok' ? 'ok' : 'error');
  }, [sound, tone, word]);
  return (
    <div role="alert" className={cx(styles.alert, styles[tone])}>
      <Icon size={48} aria-hidden="true" />
      <span>{word}</span>
    </div>
  );
}
