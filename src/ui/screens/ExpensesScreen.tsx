import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { CASH_ADJUST_REASONS, postCashAdjustment, postCashTransfer, postExpense } from '@/db/commands/cash';
import { editExpense, voidExpense } from '@/db/commands/void-docs';
import { formatMoney, toPiasters } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { UndoToast } from '../cashier/UndoToast';
import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

type Editing = { id: string; categoryId: string; amount: number };

const failWord = (code: string): string =>
  code === 'NO_SHIFT'
    ? strings.expenseEdit.noShift
    : code === 'ALREADY_VOIDED'
      ? strings.expenseEdit.already
      : code === 'LEGACY'
        ? strings.expenseEdit.legacy
        : strings.expenseEdit.failed;

/** Manager: expenses (from the box or from outside it, only the shop type), cash transfers and adjustments, and the latest 100 expenses. */
export function ExpensesScreen() {
  const { db } = useServices();
  const { context, can } = useSession();
  const [open, setOpen] = useState<'expense' | 'transfer' | 'adjust' | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; word: string } | null>(null);
  const running = useRef(false);
  const mayEdit = can('voidExpense') === 'yes';
  const data = useLiveQuery(async () => {
    // old types stay on old expenses (their names show in the list) but only the two current types can be picked
    const allCategories = await db.expenseCategories.toArray();
    const categories = allCategories.filter((c) => !c.deletedAt);
    const accounts = (await db.cashAccounts.toArray()).filter((a) => !a.deletedAt);
    const names = new Map(allCategories.map((c) => [c.id, c.name]));
    const rows = (await db.expenses.toArray())
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        number: e.number,
        issuedAt: e.issuedAt,
        amount: e.amount as number,
        category: names.get(e.categoryId as string) ?? '',
        categoryId: e.categoryId as string,
        source: (e.source as string | undefined) ?? 'safe',
        status: e.status,
        isLegacy: e.isLegacy,
      }));
    return { categories, accounts, rows };
  }, [db]);
  const runDelete = (): void => {
    const id = pending;
    setPending(null);
    if (!context || !id || running.current) return;
    running.current = true;
    void voidExpense(context, { expenseId: id, reason: 'mistake' }).then((r) => {
      running.current = false;
      setNotice(
        r.ok ? { tone: 'ok', word: strings.expenseEdit.done } : { tone: 'danger', word: failWord(r.code) },
      );
    });
  };
  if (!data) return <Skeleton />;
  const columns: Column<(typeof data.rows)[number]>[] = [
    { key: 'number', header: strings.purchases.number, cell: (r) => <span dir="ltr">{r.number}</span> },
    {
      key: 'date',
      header: strings.purchases.date,
      cell: (r) => <span dir="ltr">{cairoTime(r.issuedAt)}</span>,
    },
    { key: 'category', header: strings.cash.category, cell: (r) => r.category },
    {
      key: 'source',
      header: strings.expenseSource.label,
      cell: (r) => (r.source === 'owner' ? strings.expenseSource.owner : strings.expenseSource.safe),
    },
    { key: 'amount', header: strings.cash.amount, numeric: true, cell: (r) => formatMoney(r.amount) },
    {
      key: 'actions',
      header: '',
      cell: (r) =>
        r.status === 'voided' ? (
          <strong data-testid={`expense-voided-${r.number}`}>{strings.voidInvoice.deleted}</strong>
        ) : mayEdit && !r.isLegacy ? (
          <>
            <ActionButton
              label={strings.expenseEdit.edit}
              icon={Pencil}
              variant="ghost"
              onClick={() => {
                setNotice(null);
                setEditing({ id: r.id, categoryId: r.categoryId, amount: r.amount });
              }}
              testId={`edit-expense-${r.number}`}
            />
            <ActionButton
              label={strings.expenseEdit.delete}
              icon={Trash2}
              variant="danger"
              onClick={() => {
                setNotice(null);
                setPending(r.id);
              }}
              testId={`delete-expense-${r.number}`}
            />
          </>
        ) : null,
    },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.cash.expenses}</h1>
      {notice && <BigAlert tone={notice.tone} word={notice.word} />}
      {pending && (
        <UndoToast
          message={strings.expenseEdit.deleting}
          onUndo={() => setPending(null)}
          onExpire={runDelete}
        />
      )}
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
            variant="soft"
            onClick={() => setOpen('transfer')}
            testId="new-transfer"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.cash.adjust}
            variant="soft"
            onClick={() => setOpen('adjust')}
            testId="new-adjustment"
          />
        </div>
      </div>
      <DataTable label={strings.cash.expenses} rows={data.rows} columns={columns} rowKey={(r) => r.id} />
      <Dialog
        title={
          open === 'transfer'
            ? strings.cash.transferTitle
            : open === 'adjust'
              ? strings.cash.adjustTitle
              : strings.cash.expenseTitle
        }
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
      <Dialog title={strings.expenseEdit.title} open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <MoneyForm
            kind="expense"
            categories={data.categories}
            accounts={data.accounts}
            editing={editing}
            onDone={(word) => {
              setEditing(null);
              if (word) setNotice({ tone: 'ok', word });
            }}
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
  editing,
  onDone,
}: {
  kind: 'expense' | 'transfer' | 'adjust';
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string; kind?: string }[];
  editing?: Editing;
  onDone: (word?: string) => void;
}) {
  const { context } = useSession();
  const [categoryId, setCategoryId] = useState(
    editing && categories.some((c) => c.id === editing.categoryId)
      ? editing.categoryId
      : (categories[0]?.id ?? ''),
  );
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [source, setSource] = useState<'safe' | 'owner'>('safe');
  // the shop has one box: an expense from the box always comes out of it
  const boxId = accounts.find((a) => a.kind === 'safe')?.id ?? accounts[0]?.id ?? '';
  const [to, setTo] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState<number | null>(editing?.amount ?? null);
  const [sign, setSign] = useState<'plus' | 'minus'>('minus');
  const [reason, setReason] = useState<(typeof CASH_ADJUST_REASONS)[number]>('count_error');
  const [note, setNote] = useState('');
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
    if (editing) {
      const r = await editExpense(context, { expenseId: editing.id, categoryId, amount });
      if (r.ok) onDone(strings.expenseEdit.edited);
      else setError(failWord(r.code));
      return;
    }
    const r =
      kind === 'expense'
        ? await postExpense(context, {
            categoryId,
            amount,
            source,
            cashAccountId: source === 'safe' ? boxId : null,
          })
        : kind === 'adjust'
          ? await postCashAdjustment(context, {
              cashAccountId: from,
              amount: sign === 'plus' ? amount : -amount,
              reason,
              note,
            })
          : await postCashTransfer(context, { fromAccountId: from, toAccountId: to, amount });
    if (r.ok) onDone();
    else setError(r.code === 'NOTE_REQUIRED' ? strings.cash.noteRequired : strings.cash.failed);
  };
  return (
    <div className={styles.form}>
      <div className={styles.section}>
        {kind === 'expense' &&
          select(strings.cash.category, categoryId, setCategoryId, categories, 'expense-category')}
        {kind === 'expense' && !editing && (
          <SegmentedControl
            label={strings.expenseSource.label}
            options={[
              { key: 'safe', label: strings.expenseSource.safe },
              { key: 'owner', label: strings.expenseSource.owner },
            ]}
            value={source}
            onChange={setSource}
            testIdPrefix="expense-source-"
          />
        )}
        {kind !== 'expense' && select(strings.cash.from, from, setFrom, accounts, 'money-from')}
        {kind === 'transfer' && select(strings.cash.to, to, setTo, accounts, 'money-to')}
        {kind === 'adjust' && (
          <>
            <FormField label={strings.cash.direction}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={sign}
                  onChange={(e) => setSign(e.target.value as 'plus' | 'minus')}
                  data-testid="adjust-direction"
                >
                  <option value="minus">{strings.cash.decrease}</option>
                  <option value="plus">{strings.cash.increase}</option>
                </select>
              )}
            </FormField>
            <FormField label={strings.cash.reason}>
              {(id) => (
                <select
                  id={id}
                  className="control"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as typeof reason)}
                  data-testid="adjust-cash-reason"
                >
                  {CASH_ADJUST_REASONS.map((x) => (
                    <option key={x} value={x}>
                      {strings.cash.reasons[x]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={strings.cash.note}>
              {(id) => (
                <input
                  id={id}
                  className="control"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid="adjust-note"
                />
              )}
            </FormField>
          </>
        )}
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
