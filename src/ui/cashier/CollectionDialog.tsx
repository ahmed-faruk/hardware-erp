import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import { useRef, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postCustomerReceipt } from '@/db/commands/returns';
import { formatMoney, toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { play } from '../sound';
import { strings } from '../strings.ar';

import { CustomerPicker } from './CustomerPicker';
import { NumEntry } from './NumEntry';
import styles from './dialogs.module.css';

type Method = 'cash' | 'card' | 'instapay';
const METHODS = [
  { key: 'cash', icon: Banknote },
  { key: 'card', icon: CreditCard },
  { key: 'instapay', icon: Smartphone },
] as const;

export function CollectionDialog({
  open,
  shiftId,
  cashAccountId,
  digits,
  onClose,
  onDone,
}: {
  open: boolean;
  shiftId: string;
  cashAccountId: string;
  digits: (t: string) => string;
  onClose: () => void;
  onDone: (receiptId: string) => void;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  // the picker also reports `close` right after a pick; that must not cancel the collection
  const picked = useRef(false);
  const close = (): void => {
    picked.current = false;
    setCustomerId(null);
    onClose();
  };
  return (
    <>
      <CustomerPicker
        open={open && !customerId}
        onPick={(id) => {
          picked.current = true;
          setCustomerId(id);
        }}
        onClose={() => {
          if (!picked.current) close();
        }}
      />
      <Dialog title={strings.collection.title} open={open && customerId !== null} onClose={close}>
        {customerId && (
          <Body
            customerId={customerId}
            shiftId={shiftId}
            cashAccountId={cashAccountId}
            digits={digits}
            onDone={(id) => {
              picked.current = false;
              setCustomerId(null);
              onDone(id);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function Body({
  customerId,
  shiftId,
  cashAccountId,
  digits,
  onDone,
}: {
  customerId: string;
  shiftId: string;
  cashAccountId: string;
  digits: (t: string) => string;
  onDone: (id: string) => void;
}) {
  const { db } = useServices();
  const { context } = useSession();
  const [amount, setAmount] = useState<number | null>(null);
  const [amountOpen, setAmountOpen] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customer = useLiveQuery(
    async () => (customerId ? await db.customers.get(customerId) : undefined),
    [db, customerId],
  );
  const balance = useLiveQuery(
    async () => (customerId ? ((await db.partyBalances.get(['customer', customerId]))?.amount ?? 0) : 0),
    [db, customerId],
  );

  const save = async (): Promise<void> => {
    if (!context || !customerId || !amount) return;
    setBusy(true);
    const r = await postCustomerReceipt(context, {
      customerId,
      amount,
      method,
      reference: method === 'cash' ? null : reference || null,
      shiftId,
      cashAccountId: method === 'cash' ? cashAccountId : null,
    });
    setBusy(false);
    if (r.ok) {
      play('done');
      onDone(r.id);
    } else {
      play('error');
      setError(strings.collection.failed);
    }
  };

  return (
    <div className={styles.stack}>
      {customer && (
        <>
          <p className={styles.lead}>{customer.name}</p>
          <div className={styles.info}>
            <span>
              {strings.collection.owes}
              <strong data-testid="owes">{digits(formatMoney(balance ?? 0))}</strong>
            </span>
            <span>
              {strings.collection.amount}
              <strong data-testid="collect-amount">{amount ? digits(formatMoney(amount)) : '—'}</strong>
            </span>
          </div>
          <ActionButton
            big
            variant="ghost"
            label={strings.collection.amount}
            onClick={() => setAmountOpen(true)}
            testId="collect-amount-btn"
          />
          <div className={styles.reasons}>
            {METHODS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={styles.reason}
                style={method === key ? { borderColor: 'var(--primary)' } : undefined}
                onClick={() => setMethod(key)}
                data-testid={`collect-${key}`}
              >
                <Icon size={32} aria-hidden="true" />
                <span>{strings.receipt.pay[key]}</span>
              </button>
            ))}
          </div>
          {method !== 'cash' && (
            <input
              className="control"
              dir="ltr"
              inputMode="numeric"
              value={reference}
              onChange={(e) => setReference(e.target.value.replace(/\D/g, '').slice(0, 20))}
              aria-label={strings.collection.reference}
              placeholder={strings.collection.reference}
              data-testid="collect-reference"
            />
          )}
          {error && <BigAlert tone="danger" word={error} />}
          <ActionButton
            big
            variant="ok"
            label={strings.collection.save}
            loading={busy}
            disabled={!amount || (method !== 'cash' && !reference)}
            onClick={() => void save()}
            testId="collect-save"
          />
        </>
      )}
      <NumEntry
        title={strings.collection.amount}
        open={amountOpen}
        decimals={2}
        onCancel={() => setAmountOpen(false)}
        onSubmit={(t) => {
          const p = toPiasters(t);
          if (p.ok && p.value > 0) setAmount(p.value);
          setAmountOpen(false);
        }}
      />
    </div>
  );
}
