import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postSupplierPayment } from '@/db/commands/purchasing';
import { formatMoney, toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

type Method = 'cash' | 'instapay' | 'card' | 'other';

export function SupplierPaymentDialog({
  open,
  supplier,
  onClose,
}: {
  open: boolean;
  supplier: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog title={strings.supplierPay.title} open={open} onClose={onClose}>
      {supplier && <Body supplier={supplier} onDone={onClose} />}
    </Dialog>
  );
}

function Body({ supplier, onDone }: { supplier: { id: string; name: string }; onDone: () => void }) {
  const { db } = useServices();
  const { context } = useSession();
  const accounts = useLiveQuery(
    async () => (await db.cashAccounts.toArray()).filter((a) => !a.deletedAt),
    [db],
  );
  const owed = useLiveQuery(
    async () => -((await db.partyBalances.get(['supplier', supplier.id]))?.amount ?? 0),
    [db, supplier.id],
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const account = accountId || (accounts?.find((a) => a.kind === 'safe')?.id ?? '');

  const save = async (): Promise<void> => {
    if (!context || !amount) return;
    const r = await postSupplierPayment(context, {
      supplierId: supplier.id,
      amount,
      method,
      reference: method === 'cash' ? null : reference || null,
      cashAccountId: method === 'cash' ? account : null,
    });
    if (r.ok) onDone();
    else setError(strings.supplierPay.failed);
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <h2>{supplier.name}</h2>
        <p data-testid="we-owe">{`${strings.supplierPay.weOwe}: ${formatMoney(owed ?? 0)}`}</p>
        <NumberField
          label={strings.supplierPay.amount}
          value={amount}
          onChange={setAmount}
          parse={toPiasters}
          format={formatMoney}
          required
        />
        <FormField label={strings.supplierPay.method}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={method}
              onChange={(e) => setMethod(e.target.value as Method)}
              data-testid="supplier-pay-method"
            >
              <option value="cash">{strings.receipt.pay.cash}</option>
              <option value="instapay">{strings.receipt.pay.instapay}</option>
              <option value="card">{strings.receipt.pay.card}</option>
              <option value="other">{strings.receipt.pay.other}</option>
            </select>
          )}
        </FormField>
        {method === 'cash' ? (
          <FormField label={strings.supplierPay.account}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={account}
                onChange={(e) => setAccountId(e.target.value)}
                data-testid="supplier-pay-account"
              >
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : (
          <FormField label={strings.supplierPay.reference}>
            {(id) => (
              <input
                id={id}
                className="control"
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </FormField>
        )}
      </div>
      {error && <BigAlert tone="danger" word={error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.supplierPay.save}
          variant="ok"
          disabled={!amount}
          onClick={() => void save()}
          testId="save-supplier-payment"
        />
      </div>
    </div>
  );
}
