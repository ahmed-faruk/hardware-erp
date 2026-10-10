import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Truck, Users } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveCustomer, saveSupplier } from '@/db/commands/save-master';
import type { Customer, Supplier } from '@/db/types';
import { PRICE_LISTS } from '@/domain/pricing';
import { formatMoney, toPiasters } from '@/domain/money';
import { normalizeArabic } from '@/domain/arabic';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { StatementDialog } from './StatementDialog';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import styles from './screens.module.css';
import { useSaver } from './useSaver';

/** `5.5` (percent) -> 550 basis points: the same two-decimal parser as money. */
const percentBp = toPiasters;

function matches(query: string, ...parts: (string | null)[]): boolean {
  const q = normalizeArabic(query);
  return !q || normalizeArabic(parts.filter(Boolean).join(' ')).includes(q);
}

export function CustomersScreen() {
  const { db } = useServices();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [statementOf, setStatementOf] = useState<Customer | null>(null);
  const rows = useLiveQuery(async () => {
    const balances = new Map(
      (await db.partyBalances.where('partyType').equals('customer').toArray()).map((b) => [
        b.partyId,
        b.amount,
      ]),
    );
    const all = await db.customers
      .orderBy('name')
      .filter((c) => !c.deletedAt)
      .toArray();
    return all.map((c) => ({ ...c, balance: balances.get(c.id) ?? 0 }));
  }, [db]);
  const shown = rows?.filter((c) => matches(text, c.name, c.phone));
  const columns: Column<Customer & { balance: number }>[] = [
    { key: 'name', header: strings.customers.name, cell: (c) => c.name },
    { key: 'phone', header: strings.customers.phone, cell: (c) => <span dir="ltr">{c.phone ?? ''}</span> },
    {
      key: 'limit',
      header: strings.customers.creditLimit,
      numeric: true,
      cell: (c) => formatMoney(c.creditLimit),
    },
    { key: 'balance', header: strings.customers.owes, numeric: true, cell: (c) => formatMoney(c.balance) },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.customers.title}</h1>
      <div className={styles.toolbar}>
        <FormField label={strings.common.search}>
          {(id) => (
            <input
              id={id}
              className="control"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={strings.customers.search}
            />
          )}
        </FormField>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.customers.newCustomer}
            icon={Plus}
            onClick={() => setEditing('new')}
            testId="new-customer"
          />
        </div>
      </div>
      {!shown ? (
        <Skeleton />
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} word={strings.customers.noCustomers} />
      ) : (
        <DataTable
          label={strings.customers.title}
          rows={shown}
          columns={columns}
          rowKey={(c) => c.id}
          onRowClick={setEditing}
        />
      )}
      <Dialog
        title={editing === 'new' ? strings.customers.newCustomer : strings.customers.editCustomer}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <CustomerForm customer={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
            {editing !== 'new' && (
              <ActionButton
                label={strings.statement.open}
                variant="ghost"
                onClick={() => {
                  setStatementOf(editing);
                  setEditing(null);
                }}
                testId="open-statement"
              />
            )}
          </>
        )}
      </Dialog>
      <StatementDialog
        open={statementOf !== null}
        partyType="customer"
        party={statementOf}
        onClose={() => setStatementOf(null)}
      />
    </section>
  );
}

function CustomerForm({ customer, onDone }: { customer: Customer | null; onDone: () => void }) {
  const { context } = useSession();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [limit, setLimit] = useState<number | null>(customer?.creditLimit ?? 0);
  const [discount, setDiscount] = useState<number | null>(customer?.defaultDiscountBp ?? 0);
  const [priceList, setPriceList] = useState(customer?.priceList ?? 'retail');
  const [missing, setMissing] = useState(false);
  const saver = useSaver(onDone);
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setMissing(true);
        if (!context) return;
        void saver.run(() =>
          saveCustomer(context, {
            id: customer?.id,
            baseVersion: customer?.version,
            fields: {
              name,
              phone: phone.trim() || null,
              address: address.trim() || null,
              notes: notes.trim() || null,
              creditLimit: limit ?? 0,
              defaultDiscountBp: discount ?? 0,
              priceList,
            },
          }),
        );
      }}
    >
      <FormField
        label={strings.customers.name}
        error={missing && !name.trim() ? strings.common.required : null}
      >
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="customer-name"
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
            data-testid="customer-phone"
          />
        )}
      </FormField>
      <FormField label={strings.customers.address}>
        {(id) => (
          <input id={id} className="control" value={address} onChange={(e) => setAddress(e.target.value)} />
        )}
      </FormField>
      <NumberField
        label={strings.customers.creditLimit}
        suffix={strings.common.egp}
        value={limit}
        onChange={setLimit}
        parse={toPiasters}
        format={formatMoney}
      />
      <NumberField
        label={strings.customers.discount}
        value={discount}
        onChange={setDiscount}
        parse={percentBp}
        format={formatMoney}
      />
      <FormField label={strings.customers.priceList}>
        {(id) => (
          <select
            id={id}
            className="control"
            value={priceList}
            onChange={(e) => setPriceList(e.target.value as typeof priceList)}
            data-testid="customer-price-list"
          >
            {PRICE_LISTS.map((l) => (
              <option key={l} value={l}>
                {strings.customers.priceLists[l]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={strings.customers.notes}>
        {(id) => (
          <textarea id={id} className="control" value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </FormField>
      {saver.error && <BigAlert tone="danger" word={saver.error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-customer"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}

export function SuppliersScreen() {
  const { db } = useServices();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [payFor, setPayFor] = useState<Supplier | null>(null);
  const [statementFor, setStatementFor] = useState<Supplier | null>(null);
  const rows = useLiveQuery(async () => {
    const balances = new Map(
      (await db.partyBalances.where('partyType').equals('supplier').toArray()).map((b) => [
        b.partyId,
        b.amount,
      ]),
    );
    const all = await db.suppliers
      .orderBy('name')
      .filter((s) => !s.deletedAt && s.active)
      .toArray();
    return all.map((s) => ({ ...s, balance: balances.get(s.id) ?? 0 }));
  }, [db]);
  const shown = rows?.filter((s) => matches(text, s.name, s.phone, s.contactName));
  const columns: Column<Supplier & { balance: number }>[] = [
    { key: 'name', header: strings.suppliers.name, cell: (s) => s.name },
    { key: 'contact', header: strings.suppliers.contact, cell: (s) => s.contactName ?? '' },
    { key: 'phone', header: strings.suppliers.phone, cell: (s) => <span dir="ltr">{s.phone ?? ''}</span> },
    { key: 'balance', header: strings.suppliers.weOwe, numeric: true, cell: (s) => formatMoney(-s.balance) },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.suppliers.title}</h1>
      <div className={styles.toolbar}>
        <FormField label={strings.common.search}>
          {(id) => (
            <input
              id={id}
              className="control"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={strings.suppliers.search}
            />
          )}
        </FormField>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.suppliers.newSupplier}
            icon={Plus}
            onClick={() => setEditing('new')}
            testId="new-supplier"
          />
        </div>
      </div>
      {!shown ? (
        <Skeleton />
      ) : shown.length === 0 ? (
        <EmptyState icon={Truck} word={strings.suppliers.noSuppliers} />
      ) : (
        <DataTable
          label={strings.suppliers.title}
          rows={shown}
          columns={columns}
          rowKey={(s) => s.id}
          onRowClick={setEditing}
        />
      )}
      <Dialog
        title={editing === 'new' ? strings.suppliers.newSupplier : strings.suppliers.editSupplier}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <SupplierForm supplier={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
            {editing !== 'new' && (
              <div className={styles.actions}>
                <ActionButton
                  label={strings.supplierPay.button}
                  variant="ghost"
                  onClick={() => {
                    setPayFor(editing);
                    setEditing(null);
                  }}
                  testId="open-supplier-payment"
                />
                <ActionButton
                  label={strings.statement.open}
                  variant="ghost"
                  onClick={() => {
                    setStatementFor(editing);
                    setEditing(null);
                  }}
                  testId="open-supplier-statement"
                />
              </div>
            )}
          </>
        )}
      </Dialog>
      <SupplierPaymentDialog open={payFor !== null} supplier={payFor} onClose={() => setPayFor(null)} />
      <StatementDialog
        open={statementFor !== null}
        partyType="supplier"
        party={statementFor}
        onClose={() => setStatementFor(null)}
      />
    </section>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const { context } = useSession();
  const [name, setName] = useState(supplier?.name ?? '');
  const [contact, setContact] = useState(supplier?.contactName ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [missing, setMissing] = useState(false);
  const saver = useSaver(onDone);
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setMissing(true);
        if (!context) return;
        void saver.run(() =>
          saveSupplier(context, {
            id: supplier?.id,
            baseVersion: supplier?.version,
            fields: {
              name,
              contactName: contact.trim() || null,
              phone: phone.trim() || null,
              address: address.trim() || null,
              notes: notes.trim() || null,
            },
          }),
        );
      }}
    >
      <FormField
        label={strings.suppliers.name}
        error={missing && !name.trim() ? strings.common.required : null}
      >
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="supplier-name"
          />
        )}
      </FormField>
      <FormField label={strings.suppliers.contact}>
        {(id) => (
          <input id={id} className="control" value={contact} onChange={(e) => setContact(e.target.value)} />
        )}
      </FormField>
      <FormField label={strings.suppliers.phone}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </FormField>
      <FormField label={strings.suppliers.address}>
        {(id) => (
          <input id={id} className="control" value={address} onChange={(e) => setAddress(e.target.value)} />
        )}
      </FormField>
      <FormField label={strings.suppliers.notes}>
        {(id) => (
          <textarea id={id} className="control" value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </FormField>
      {saver.error && <BigAlert tone="danger" word={saver.error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-supplier"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}
