import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Check, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postSale, type SaleReceipt } from '@/db/commands/post-sale';
import type { Cart } from '@/domain/cart';
import { toSaleLines } from '@/domain/cart';
import { formatMoney, toPiasters } from '@/domain/money';
import type { PaymentInput } from '@/domain/payments';
import type { Action } from '@/domain/permissions';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { strings } from '../strings.ar';

import { CustomerBalances, CustomerPicker } from './CustomerPicker';
import { NumEntry } from './NumEntry';
import { PAY_METHODS, PayMethodButton } from './PayMethodButton';
import { useShortcuts } from './useShortcuts';

import styles from './PayScreen.module.css';

type Method = (typeof PAY_METHODS)[number]['method'];

export interface PayScreenProps {
  cart: Cart;
  total: number;
  digits: (text: string) => string;
  sale: { warehouseId: string; shiftId: string; cashAccountId: string };
  tokens: string[];
  ask: (action: Action) => Promise<string | null>;
  onCustomer: (id: string | null) => void;
  onBack: () => void;
  onPaid: (sale: SaleReceipt) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}

/** Step 2: pick methods in fixed order and color, add amounts until nothing remains, then finish (Ctrl+Enter). */
export function PayScreen({
  cart,
  total,
  digits,
  sale,
  tokens,
  ask,
  onCustomer,
  onBack,
  onPaid,
  pickerOpen,
  setPickerOpen,
}: PayScreenProps) {
  const { db, runner } = useServices();
  const { context } = useSession();
  const [payments, setPayments] = useState<PaymentInput[]>([]);
  const [method, setMethod] = useState<Method | null>(null);
  const [pendingAfterPicker, setPendingAfterPicker] = useState<Method | null>(null);
  const [reference, setReference] = useState<{ method: Method; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customer = useLiveQuery(async () => {
    if (!cart.customerId) return null;
    const c = await db.customers.get(cart.customerId);
    const balance = (await db.partyBalances.get(['customer', cart.customerId]))?.amount ?? 0;
    return c ? { customer: c, balance } : null;
  }, [db, cart.customerId]);

  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = total - paid;

  const choose = (m: Method): void => {
    if (m === 'credit' && !cart.customerId) {
      setPendingAfterPicker(m);
      setPickerOpen(true);
      return;
    }
    setMethod(m);
  };

  const addPayment = (p: PaymentInput): void => {
    setPayments((list) => [...list, p]);
    setMethod(null);
    setReference(null);
  };

  const amountEntered = (text: string): void => {
    const value = toPiasters(text);
    if (!method || !value.ok || value.value <= 0) return;
    const amount = Math.min(value.value, remaining);
    if (method === 'cash') addPayment({ method, amount, tendered: value.value });
    else if (method === 'credit') addPayment({ method, amount });
    else {
      setReference({ method, amount });
      setMethod(null);
    }
  };

  const finish = async (): Promise<void> => {
    if (!context || busy || remaining !== 0) return;
    setBusy(true);
    setError(null);
    const approvalTokens = [...tokens];
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await postSale(context, {
        lines: toSaleLines(cart),
        customerId: cart.customerId,
        payments,
        invoiceDiscount: cart.invoiceDiscount,
        ...sale,
        isOffline: !runner.getSnapshot().online,
        creditPolicy: 'allow',
        approvalTokens,
      });
      if (result.ok) {
        setBusy(false);
        return onPaid(result);
      }
      if (result.code === 'APPROVAL_REQUIRED') {
        const token = await ask(result.message as Action);
        if (token) {
          approvalTokens.push(token);
          continue;
        }
      }
      setError(result.code === 'NEGATIVE_STOCK' ? strings.sell.negativeBlocked : strings.sell.saleFailed);
      break;
    }
    setBusy(false);
  };

  useShortcuts({ finish: () => void finish() });

  return (
    <section className={styles.pay}>
      <div className={styles.col}>
        <div className={styles.top}>
          <ActionButton
            big
            label={strings.common.back}
            icon={ArrowRight}
            variant="ghost"
            onClick={onBack}
            testId="pay-back"
          />
          <div className={styles.numbers}>
            <span>{strings.sell.total}</span>
            <strong className={styles.big} data-testid="pay-total">
              {digits(formatMoney(total))}
            </strong>
          </div>
          <div className={styles.numbers}>
            <span>{strings.sell.remaining}</span>
            <strong className={remaining === 0 ? styles.okBig : styles.big} data-testid="remaining">
              {digits(formatMoney(remaining))}
            </strong>
          </div>
        </div>

        {payments.length > 0 && (
          <ul className={styles.chips}>
            {payments.map((p, i) => (
              <li key={i} className={styles.chip} data-testid={`payment-${i}`}>
                <span>{strings.sell[`pay_${p.method as Method}`]}</span>
                <strong>{digits(formatMoney(p.amount))}</strong>
                <button
                  type="button"
                  className={styles.x}
                  onClick={() => setPayments((l) => l.filter((_, j) => j !== i))}
                  aria-label={strings.actions.remove}
                >
                  <Trash2 size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.customer}>
          <ActionButton
            big
            label={customer ? customer.customer.name : strings.sell.chooseCustomer}
            icon={UserRound}
            variant="ghost"
            onClick={() => setPickerOpen(true)}
            testId="choose-customer"
          />
          {customer && <CustomerBalances info={customer} digits={digits} />}
        </div>
      </div>
      <div className={styles.col}>
        <div className={styles.methods}>
          {PAY_METHODS.map((m) => (
            <PayMethodButton
              key={m.method}
              method={m.method}
              selected={method === m.method}
              disabled={remaining === 0}
              onClick={() => choose(m.method)}
            />
          ))}
        </div>

        {error && <BigAlert tone="danger" word={error} />}
        <ActionButton
          label={strings.sell.paid}
          icon={Check}
          variant="ok"
          layout="stack"
          onClick={() => void finish()}
          disabled={remaining !== 0}
          loading={busy}
          testId="finish"
        />
      </div>

      <NumEntry
        title={method ? strings.sell[`pay_${method}`] : strings.sell.pay}
        open={method !== null}
        decimals={2}
        hint={`${strings.sell.remaining}: ${digits(formatMoney(remaining))}`}
        extra={
          <ActionButton
            big
            label={strings.sell.fullAmount}
            variant="ghost"
            onClick={() => amountEntered(formatMoney(remaining))}
            testId="full-amount"
          />
        }
        onCancel={() => setMethod(null)}
        onSubmit={amountEntered}
      />
      <NumEntry
        title={strings.sell.reference}
        open={reference !== null}
        decimals={0}
        onCancel={() => setReference(null)}
        onSubmit={(text) =>
          reference &&
          text !== '0' &&
          addPayment({ method: reference.method, amount: reference.amount, reference: text })
        }
      />
      <CustomerPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setPendingAfterPicker(null);
        }}
        onPick={(id) => {
          onCustomer(id);
          setPickerOpen(false);
          if (pendingAfterPicker) {
            setMethod(pendingAfterPicker);
            setPendingAfterPicker(null);
          }
        }}
      />
    </section>
  );
}
