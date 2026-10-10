import { useEffect, useState, type ReactNode } from 'react';

import { Dialog } from '../components/Dialog';
import { NumPad } from '../components/NumPad';

import styles from './NumEntry.module.css';

export interface NumEntryProps {
  title: string;
  open: boolean;
  /** 0 = whole numbers, 2 = money or percent, 3 = quantities */
  decimals: 0 | 2 | 3;
  initial?: string;
  hint?: ReactNode;
  /** extra buttons next to the pad (for example "the whole remaining amount") */
  extra?: ReactNode;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}

/** Add a typed key to the text, never allowing two dots, a leading zero run, or more decimals than allowed. */
export function pushKey(text: string, key: string, decimals: number): string {
  if (key === '.') return decimals > 0 && !text.includes('.') ? (text || '0') + '.' : text;
  if (!/^\d$/.test(key)) return text;
  const dot = text.indexOf('.');
  if (dot !== -1 && text.length - dot - 1 >= decimals) return text;
  if (text === '0') return key;
  return text.length >= 12 ? text : text + key;
}

/** Big-digit entry on the number pad. Digits also work from the keyboard. No free text anywhere (UX-05). */
export function NumEntry(props: NumEntryProps) {
  // the dialog renders its children only while open, so the body starts fresh (empty or the initial text) every time
  return (
    <Dialog title={props.title} open={props.open} onClose={props.onCancel}>
      <NumEntryBody {...props} />
    </Dialog>
  );
}

function NumEntryBody({ decimals, initial = '', hint, extra, onSubmit }: NumEntryProps) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^[\d.]$/.test(e.key)) setText((t) => pushKey(t, e.key, decimals));
      else if (e.key === 'Backspace') setText((t) => t.slice(0, -1));
      else if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit(text || '0');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decimals, text, onSubmit]);
  return (
    <div className={styles.body}>
      <div className={styles.display} dir="ltr" data-testid="num-display">
        {text || '0'}
      </div>
      {hint && <div className={styles.hint}>{hint}</div>}
      <NumPad
        decimal={decimals > 0}
        onDigit={(d) => setText((t) => pushKey(t, d, decimals))}
        onBackspace={() => setText((t) => t.slice(0, -1))}
        onOk={() => onSubmit(text || '0')}
      />
      {extra && <div className={styles.extra}>{extra}</div>}
    </div>
  );
}
