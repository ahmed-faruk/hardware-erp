import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { addCustomer } from '@/db/commands/save-master';
import type { Customer } from '@/db/types';
import { formatMoney } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { NumPad } from '../components/NumPad';
import { strings } from '../strings.ar';

import styles from './dialogs.module.css';

export interface CustomerInfo {
  customer: Customer;
  balance: number;
}

/** What the cashier must see before selling on credit (POS-11): balance, limit, what is still available. */
export function CustomerBalances({ info, digits }: { info: CustomerInfo; digits: (text: string) => string }) {
  const available = info.customer.creditLimit - info.balance;
  return (
    <div className={styles.info} data-testid="customer-info">
      <span>
        {strings.sell.balance}
        <strong>{digits(formatMoney(info.balance))}</strong>
      </span>
      <span>
        {strings.sell.limit}
        <strong>{digits(formatMoney(info.customer.creditLimit))}</strong>
      </span>
      <span>
        {strings.sell.available}
        <strong>{digits(formatMoney(available))}</strong>
      </span>
    </div>
  );
}

function PickerBody({ onPick }: { onPick: (id: string) => void }) {
  const { db } = useServices();
  const session = useSession();
  const { context } = session;
  const [digitsTyped, setDigits] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const customers = useLiveQuery(
    () =>
      db.customers
        .orderBy('name')
        .filter((c) => !c.deletedAt && c.active)
        .toArray(),
    [db],
  );
  const shown = (customers ?? []).filter(
    (c) => !digitsTyped || (c.phone ?? '').replace(/\D/g, '').includes(digitsTyped),
  );
  const canAdd = session.can('addCustomer') === 'yes';

  if (adding) {
    return (
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (!context || !name.trim()) return setError(strings.common.required);
          void addCustomer(context, { name, phone }).then((r) =>
            r.ok ? onPick(r.id) : setError(strings.errors.saveFailed),
          );
        }}
      >
        <FormField label={strings.customers.name}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="new-customer-name"
            />
          )}
        </FormField>
        <FormField label={strings.customers.phone}>
          {(id) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="new-customer-phone"
            />
          )}
        </FormField>
        {error && <BigAlert tone="danger" word={error} />}
        <ActionButton big label={strings.common.save} type="submit" variant="ok" testId="save-new-customer" />
        <ActionButton big label={strings.common.cancel} variant="ghost" onClick={() => setAdding(false)} />
      </form>
    );
  }
  return (
    <div className={styles.stack}>
      <div
        className={styles.phone}
        dir="ltr"
        aria-label={strings.sell.phoneDigits}
        data-testid="phone-filter"
      >
        {digitsTyped || strings.sell.phoneDigits}
      </div>
      <NumPad
        onDigit={(d) => setDigits((t) => (t.length < 11 ? t + d : t))}
        onBackspace={() => setDigits((t) => t.slice(0, -1))}
        onOk={() => shown.length === 1 && onPick((shown[0] as Customer).id)}
      />
      <ul className={styles.avatars}>
        {shown.slice(0, 60).map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className={styles.avatar}
              onClick={() => onPick(c.id)}
              data-testid={`customer-${c.id}`}
            >
              <span
                className={styles.initial}
                style={{ background: `var(--cat-${(i % 8) + 1})` }}
                aria-hidden="true"
              >
                {[...c.name][0]}
              </span>
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {canAdd && (
        <ActionButton
          big
          label={strings.sell.newCustomer}
          icon={UserPlus}
          variant="ghost"
          onClick={() => setAdding(true)}
          testId="add-customer"
        />
      )}
    </div>
  );
}

export function CustomerPicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={strings.sell.chooseCustomer} open={open} onClose={onClose}>
      <PickerBody onPick={onPick} />
    </Dialog>
  );
}
