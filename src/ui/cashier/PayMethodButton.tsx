import { Banknote, CreditCard, NotebookPen, Smartphone, type LucideIcon } from 'lucide-react';

import type { PayMethod } from '@/domain/payments';

import { strings } from '../strings.ar';
import { cx } from '../cx';

import styles from './PayMethodButton.module.css';

/** Fixed order, color and icon everywhere (UX-12): cash green, credit orange, card blue, InstaPay purple. */
export const PAY_METHODS: { method: Exclude<PayMethod, 'wallet'>; icon: LucideIcon; label: string }[] = [
  { method: 'cash', icon: Banknote, label: strings.sell.pay_cash },
  { method: 'credit', icon: NotebookPen, label: strings.sell.pay_credit },
  { method: 'card', icon: CreditCard, label: strings.sell.pay_card },
  { method: 'instapay', icon: Smartphone, label: strings.sell.pay_instapay },
];

export function PayMethodButton({
  method,
  selected,
  disabled,
  onClick,
}: {
  method: (typeof PAY_METHODS)[number]['method'];
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const entry = PAY_METHODS.find((m) => m.method === method)!;
  const Icon = entry.icon;
  return (
    <button
      type="button"
      className={cx(styles.button, styles[method], selected && styles.selected)}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={`pay-${method}`}
    >
      <Icon size={36} aria-hidden="true" />
      <span>{entry.label}</span>
    </button>
  );
}
