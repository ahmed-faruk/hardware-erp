import { PauseCircle, ShoppingCart, Volume2 } from 'lucide-react';

import { ActionButton } from '../components/ActionButton';
import { strings } from '../strings.ar';

import styles from './TotalBar.module.css';

export interface TotalBarProps {
  total: string;
  count: string;
  heldCount: number;
  disabled: boolean;
  onPay: () => void;
  onHold: () => void;
  onHeld: () => void;
  onSpeak: () => void;
  /** phones only: opens the cart as a sheet */
  onCart?: () => void;
}

/** Sticky at the bottom: the total in the biggest type, speak, hold and pay (F9). */
export function TotalBar({
  total,
  count,
  heldCount,
  disabled,
  onPay,
  onHold,
  onHeld,
  onSpeak,
  onCart,
}: TotalBarProps) {
  return (
    <div className={styles.bar} data-testid="total-bar">
      <div className={styles.numbers}>
        <span className={styles.label}>{`${strings.sell.total} · ${count} ${strings.sell.itemsCount}`}</span>
        <span className={styles.total} data-testid="total">
          {total}
        </span>
      </div>
      <div className={styles.actions}>
        {onCart && (
          <ActionButton
            label={strings.sell.cartLine}
            icon={ShoppingCart}
            variant="ghost"
            layout="stack"
            onClick={onCart}
            testId="open-cart"
          />
        )}
        <ActionButton
          label={strings.sell.speak}
          icon={Volume2}
          variant="ghost"
          layout="stack"
          onClick={onSpeak}
          disabled={disabled}
        />
        <ActionButton
          label={strings.sell.hold}
          icon={PauseCircle}
          variant="ghost"
          layout="stack"
          onClick={onHold}
          disabled={disabled}
          testId="hold"
        />
        <button
          type="button"
          className={styles.held}
          onClick={onHeld}
          data-testid="held"
          aria-label={strings.sell.held}
        >
          {heldCount}
        </button>
        <ActionButton
          label={strings.sell.pay}
          variant="primary"
          layout="stack"
          onClick={onPay}
          disabled={disabled}
          testId="pay"
        />
      </div>
    </div>
  );
}
