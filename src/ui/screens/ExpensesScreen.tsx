import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postCashTransfer, postExpense, saveExpenseCategory } from '@/db/commands/cash';
import { formatMoney, toPiasters } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

/** Manager: expenses from any account, cash transfers between accounts, and the list of expense categories the cashier picks from. */
export function ExpensesScreen() {
  const { db } = useServices();
  const { context } = useSession();
  const [open, setOpen] = useState<'expense' | 'transfer' | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const data = useLiveQuery(async () => {
    const categories = (await db.expenseCategories.toArray()).filter((c) => !c.deletedAt);
    const accounts = (await db.cashAccounts.toArray()).filter((a) => !a.deletedAt);
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const rows = (await db.expenses.toArray())
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        number: e.number,
        issuedAt: e.issuedAt,
        amount: e.amount as number,
        category: names.get(e.categoryId as string) ?? '',
      }));
    return { categories, accounts, rows };
  }, [db]);
  if (!data) return <Skeleton />;
  const columns: Column<(typeof data.rows)[number]>[] = [
    { key: 'number', header: strings.purchases.number, cell: (r) => <span dir="ltr">{r.number}</span> },
    {
      key: 'date',
      header: strings.purchases.date,
      cell: (r) => <span dir="ltr">{cairoTime(r.issuedAt)}</span>,
    },
    { key: 'category', header: strings.cash.category, cell: (r) => r.category },
    { key: 'amount', header: strings.cash.amount, numeric: true, cell: (r) => formatMoney(r.amount) },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.cash.expenses}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.cash.expense}
            icon={Plus}
            onClick={() => setOpen('expense')}
            testId="new-expense"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.cash.transfer}
            variant="ghost"
            onClick={() => setOpen('transfer')}
            testId="new-transfer"
          />
        </div>
      </div>
      <div className={styles.section}>
        <h2>{strings.cash.categories}</h2>
        <p data-testid="categories">
          {data.categories.map((c) => c.name).join(strings.cash.listSeparator) || strings.cash.noCategories}
        </p>
        <div className={styles.row}>
          <FormField label={strings.cash.newCategory}>
            {(id) => (
              <input
                id={id}
                className="control"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                data-testid="category-name"
              />
            )}
          </FormField>
          <ActionButton
            label={strings.common.add}
            icon={Plus}
            disabled={!newCategory.trim()}
            onClick={() => {
              if (!context) return;
              void saveExpenseCategory(context, { name: newCategory }).then(
                (r) => r.ok && setNewCategory(''),
              );
            }}
            testId="add-category"
          />
        </div>
      </div>
      <DataTable label={strings.cash.expenses} rows={data.rows} columns={columns} rowKey={(r) => r.id} />
      <Dialog
        title={open === 'transfer' ? strings.cash.transferTitle : strings.cash.expenseTitle}
        open={open !== null}
        onClose={() => setOpen(null)}
      >
        {open && (
          <MoneyForm
            kind={open}
            categories={data.categories}
            accounts={data.accounts}
            onDone={() => setOpen(null)}
          />
        )}
      </Dialog>
    </section>
  );
}

function MoneyForm({
  kind,
  categories,
  accounts,
  onDone,
}: {
  kind: 'expense' | 'transfer';
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { context } = useSession();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: { id: string; name: string }[],
    testId: string,
  ) => (
    <FormField label={label}>
      {(id) => (
        <select
          id={id}
          className="control"
          value={value}
          onChange={(e) => set(e.target.value)}
          data-testid={testId}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
  const save = async (): Promise<void> => {
    if (!context || !amount) return;
    const r =
      kind === 'expense'
        ? await postExpense(context, { categoryId, amount, cashAccountId: from })
        : await postCashTransfer(context, { fromAccountId: from, toAccountId: to, amount });
    if (r.ok) onDone();
    else setError(strings.cash.failed);
  };
  return (
    <div className={styles.form}>
      <div className={styles.section}>
        {kind === 'expense' &&
          select(strings.cash.category, categoryId, setCategoryId, categories, 'expense-category')}
        {select(
          kind === 'expense' ? strings.supplierPay.account : strings.cash.from,
          from,
          setFrom,
          accounts,
          'money-from',
        )}
        {kind === 'transfer' && select(strings.cash.to, to, setTo, accounts, 'money-to')}
        <NumberField
          label={strings.cash.amount}
          value={amount}
          onChange={setAmount}
          parse={toPiasters}
          format={formatMoney}
          required
        />
      </div>
      {error && <BigAlert tone="danger" word={error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.cash.save}
          variant="ok"
          disabled={!amount || (kind === 'expense' && !categoryId)}
          onClick={() => void save()}
          testId="save-money"
        />
      </div>
    </div>
  );
}
