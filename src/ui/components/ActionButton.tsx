import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

import { cx } from '../cx';

import styles from './ActionButton.module.css';

export interface ActionButtonProps {
  label: string;
  icon?: LucideIcon;
  variant?: 'primary' | 'ok' | 'danger' | 'ghost';
  /** `stack` = icon over label (cashier style); `inline` = icon beside label (forms and tables) */
  layout?: 'stack' | 'inline';
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  /** cashier screens: 56 px high (docs/DESIGN_SYSTEM.md §4, UX-11) */
  big?: boolean;
  onClick?: () => void;
  testId?: string;
}

export function ActionButton({
  label,
  icon: Icon,
  variant = 'primary',
  layout = 'inline',
  type = 'button',
  disabled,
  loading,
  big,
  onClick,
  testId,
}: ActionButtonProps) {
  const Glyph = loading ? Loader2 : Icon;
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[layout],
        big && styles.big,
        loading && styles.loading,
      )}
      disabled={disabled || loading}
      aria-disabled={disabled || loading}
      onClick={onClick}
      data-testid={testId}
    >
      {Glyph && <Glyph size={layout === 'stack' ? 28 : 20} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
