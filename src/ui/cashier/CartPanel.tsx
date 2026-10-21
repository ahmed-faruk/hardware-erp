import { Minus, Percent, Plus, Tag, Trash2 } from 'lucide-react';

import type { Cart } from '@/domain/cart';
import { formatMoney, formatQty } from '@/domain/money';
import type { InvoiceResult } from '@/domain/totals';

import { ActionButton } from '../components/ActionButton';
import { EmptyState } from '../components/EmptyState';
import { strings } from '../strings.ar';

import { ShoppingCart } from 'lucide-react';
import styles from './CartPanel.module.css';

export interface CartPanelProps {
  cart: Cart;
  invoice: InvoiceResult;
  digits: (text: string) => string;
  onStep: (key: string, deltaMilli: number) => void;
  onQtyPad: (key: string) => void;
  onRemove: (key: string) => void;
  onDiscount: (key: string) => void;
  onPrice: (key: string) => void;
  onInvoiceDiscount: () => void;
}

/** Cart lines: − qty + (56 px), the line total big, discount / price / remove on the side. */
export function CartPanel({
  cart,
  invoice,
  digits,
  onStep,
  onQtyPad,
  onRemove,
  onDiscount,
  onPrice,
  onInvoiceDiscount,
}: CartPanelProps) {
  if (cart.lines.length === 0) return <EmptyState icon={ShoppingCart} word={strings.sell.emptyCart} />;
  return (
    <div className={styles.panel} data-testid="cart">
      <ul className={styles.lines}>
        {cart.lines
          .map((line, i) => ({ line, i }))
          .reverse()
          .map(({ line, i }) => (
            <li key={line.key} className={styles.line} data-testid={`line-${i}`}>
              <div className={styles.head}>
                <span className={styles.name}>{line.name}</span>
                <span className={styles.total}>
                  {digits(formatMoney(invoice.lines[i]?.finalAmount ?? 0))}
                </span>
              </div>
              <div className={styles.row}>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    className={styles.step}
                    onClick={() => onStep(line.key, -1000)}
                    aria-label={strings.common.back}
                  >
                    <Minus size={24} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.qty}
                    onClick={() => onQtyPad(line.key)}
                    aria-label={strings.sell.quantity}
                    data-testid={`qty-${i}`}
                  >
                    {digits(formatQty(line.qtyMilli))}
                  </button>
                  <button
                    type="button"
                    className={styles.step}
                    onClick={() => onStep(line.key, 1000)}
                    aria-label={strings.common.add}
                  >
                    <Plus size={24} aria-hidden="true" />
                  </button>
                </div>
                <span className={styles.unit}>{`× ${digits(formatMoney(line.unitPrice))}`}</span>
                <div className={styles.tools}>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => onDiscount(line.key)}
                    aria-label={strings.sell.discount}
                    data-testid={`discount-${i}`}
                  >
                    <Percent size={22} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => onPrice(line.key)}
                    aria-label={strings.sell.price}
                    data-testid={`price-${i}`}
                  >
                    <Tag size={22} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => onRemove(line.key)}
                    aria-label={strings.actions.remove}
                    data-testid={`remove-${i}`}
                  >
                    <Trash2 size={22} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
      </ul>
      <ActionButton
        big
        label={strings.sell.discount}
        icon={Percent}
        variant="ghost"
        onClick={onInvoiceDiscount}
        testId="invoice-discount"
      />
      {invoice.invoiceDiscount > 0 && (
        <p
          className={styles.note}
        >{`${strings.sell.discount}: ${digits(formatMoney(invoice.invoiceDiscount))}`}</p>
      )}
    </div>
  );
}
