import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { loadPayrollEntries, paySalary, recordAdvance, recordDeduction } from '@/db/commands/payroll';
import type { CashAccount, Worker } from '@/db/types';
import { formatMoney, toPiasters } from '@/domain/money';
import { payrollState, type PayrollKind } from '@/domain/payroll';
import { cairoTime } from '@/domain/receipt';
import type { ReportTable } from '@/domain/reports';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { cairoDay } from './dates';
import styles from './screens.module.css';

const t = strings.payroll;

/** The last 12 months, newest first, as yyyy-mm. */
function monthOptions(): string[] {
  const [y, m] = cairoDay().split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

type Dlg =
  | { kind: 'advance' | 'deduction'; worker: Worker }
  | { kind: 'salary'; worker: Worker }
  | { kind: 'statement'; worker: Worker }
  | null;

/** Manager: each worker's monthly salary, advances, deductions and the salary payment that settles them. */
export function PayrollScreen() {
  const { db } = useServices();
  const { can } = useSession();
  const months = monthOptions();
  const [month, setMonth] = useState(months[0]!);
  const [dlg, setDlg] = useState<Dlg>(null);
  const data = useLiveQuery(async () => {
    const workers = (await db.workers.toArray()).filter((w) => !w.deletedAt && w.active);
    const entries = await Promise.all(
      workers.map(async (w) => [w.id, await loadPayrollEntries(db, w.id)] as const),
    );
    const accounts = (await db.cashAccounts.toArray()).filter((a) => !a.deletedAt && a.kind !== 'drawer');
    return {
      workers: workers.sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      entries: new Map(entries),
      accounts,
    };
  }, [db]);
  const manage = can('managePayroll') === 'yes';
  return (
    <section>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.muted}>{t.hint}</p>
      <div className={styles.toolbar}>
        <FormField label={t.month}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              data-testid="payroll-month"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      {!data ? (
        <Skeleton />
      ) : data.workers.length === 0 ? (
        <EmptyState icon={Banknote} word={t.noWorkers} />
      ) : (
        <div className={styles.payGrid}>
          {data.workers.map((w) => {
            const st = payrollState(data.entries.get(w.id) ?? [], w.id, w.monthlySalary ?? 0, month);
            return (
              <div key={w.id} className={styles.payCard} data-testid={`payroll-${w.id}`}>
                <div className={styles.payHead}>
                  <strong>{w.name}</strong>
                  <span className={styles.muted}>{strings.roles[w.role]}</span>
                  {st.paid && <span className={styles.paidTag}>{t.paid}</span>}
                </div>
                <div className={styles.kv}>
                  <span>{t.salary}</span>
                  <b>{w.monthlySalary == null ? t.noSalary : formatMoney(w.monthlySalary)}</b>
                </div>
                <div className={styles.kv}>
                  <span>{t.advances}</span>
                  <b data-testid={`advances-${w.id}`}>{formatMoney(st.advances)}</b>
                </div>
                <div className={styles.kv}>
                  <span>{t.deductions}</span>
                  <b data-testid={`deductions-${w.id}`}>{formatMoney(st.deductions)}</b>
                </div>
                <div className={styles.kv}>
                  <span>{t.carryIn}</span>
                  <b>{formatMoney(st.carryIn)}</b>
                </div>
                <div className={styles.kv}>
                  <span>{t.net}</span>
                  <b data-testid={`net-${w.id}`}>
                    {w.monthlySalary == null ? '—' : formatMoney(st.slip.net)}
                  </b>
                </div>
                <div className={styles.actions}>
                  {manage && (
                    <>
                      <ActionButton
                        label={t.advance}
                        variant="soft"
                        onClick={() => setDlg({ kind: 'advance', worker: w })}
                        testId={`advance-${w.id}`}
                      />
                      <ActionButton
                        label={t.deduction}
                        variant="soft"
                        disabled={st.paid}
                        onClick={() => setDlg({ kind: 'deduction', worker: w })}
                        testId={`deduction-${w.id}`}
                      />
                      <ActionButton
                        label={t.pay}
                        disabled={st.paid || w.monthlySalary == null}
                        onClick={() => setDlg({ kind: 'salary', worker: w })}
                        testId={`pay-salary-${w.id}`}
                      />
                    </>
                  )}
                  <ActionButton
                    label={t.statement}
                    variant="ghost"
                    onClick={() => setDlg({ kind: 'statement', worker: w })}
                    testId={`statement-${w.id}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog
        title={
          dlg
            ? dlg.kind === 'statement'
              ? `${t.statement}: ${dlg.worker.name}`
              : `${t[dlg.kind === 'salary' ? 'pay' : dlg.kind]}: ${dlg.worker.name}`
            : ''
        }
        open={dlg !== null}
        onClose={() => setDlg(null)}
      >
        {dlg && data && dlg.kind === 'statement' && (
          <Statement entries={data.entries.get(dlg.worker.id) ?? []} />
        )}
        {dlg && data && (dlg.kind === 'advance' || dlg.kind === 'deduction') && (
          <AmountForm
            kind={dlg.kind}
            worker={dlg.worker}
            month={month}
            accounts={data.accounts}
            onDone={() => setDlg(null)}
          />
        )}
        {dlg && data && dlg.kind === 'salary' && (
          <SalaryForm
            worker={dlg.worker}
            month={month}
            accounts={data.accounts}
            entries={data.entries.get(dlg.worker.id) ?? []}
            onDone={() => setDlg(null)}
          />
        )}
      </Dialog>
    </section>
  );
}

function AccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: CashAccount[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FormField label={t.account}>
      {(id) => (
        <select
          id={id}
          className="control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="payroll-account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

function AmountForm({
  kind,
  worker,
  month,
  accounts,
  onDone,
}: {
  kind: 'advance' | 'deduction';
  worker: Worker;
  month: string;
  accounts: CashAccount[];
  onDone: () => void;
}) {
  const { context } = useSession();
  const [amount, setAmount] = useState<number | null>(null);
  const [account, setAccount] = useState(
    accounts.find((a) => a.kind === 'safe')?.id ?? accounts[0]?.id ?? '',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (!context || !amount) return;
    setBusy(true);
    const r =
      kind === 'advance'
        ? await recordAdvance(context, { employeeId: worker.id, amount, cashAccountId: account, month, note })
        : await recordDeduction(context, { employeeId: worker.id, amount, month, note });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.code === 'MONTH_PAID' ? t.monthPaid : t.failed);
  };
  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <NumberField
          label={t.amount}
          value={amount}
          onChange={setAmount}
          parse={toPiasters}
          format={formatMoney}
          required
        />
        {kind === 'advance' &&
          (accounts.length === 0 ? (
            <BigAlert tone="warn" word={t.noAccount} sound={false} />
          ) : (
            <AccountSelect accounts={accounts} value={account} onChange={setAccount} />
          ))}
        <FormField label={t.note}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="payroll-note"
            />
          )}
        </FormField>
      </div>
      {error && <BigAlert tone="danger" word={error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          variant="ok"
          loading={busy}
          disabled={!amount || (kind === 'advance' && !account)}
          onClick={() => void save()}
          testId="save-payroll"
        />
      </div>
    </div>
  );
}

function slipTable(
  worker: Worker,
  month: string,
  slip: ReturnType<typeof payrollState>['slip'],
): ReportTable {
  return {
    title: `${t.slipTitle}: ${worker.name} — ${month}`,
    headers: [t.salary, t.amount],
    rows: [
      [t.gross, formatMoney(slip.gross)],
      [t.totalAdvances, formatMoney(slip.advancesTotal)],
      [t.totalDeductions, formatMoney(slip.deductionsTotal)],
      [t.carryIn, formatMoney(slip.carryIn)],
      [t.carriesOut, formatMoney(slip.carryOut)],
    ],
    totals: [t.net, formatMoney(slip.net)],
  };
}

function SalaryForm({
  worker,
  month,
  accounts,
  entries,
  onDone,
}: {
  worker: Worker;
  month: string;
  accounts: CashAccount[];
  entries: Parameters<typeof payrollState>[0];
  onDone: () => void;
}) {
  const { db } = useServices();
  const { context } = useSession();
  const state = payrollState(entries, worker.id, worker.monthlySalary ?? 0, month);
  const slip = state.slip;
  const [account, setAccount] = useState(
    accounts.find((a) => a.kind === 'safe')?.id ?? accounts[0]?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const print = async (): Promise<void> => {
    const [render, { printHtml, cairoFontFaces }, company] = await Promise.all([
      import('../print/render'),
      import('../print/printHtml'),
      db.companies.toCollection().first(),
    ]);
    await printHtml(
      render.renderReportHtml(
        {
          shopName: company?.name ?? '',
          title: t.slipTitle,
          subtitle: `${worker.name} — ${month}`,
          upTo: '',
          tables: [slipTable(worker, month, slip)],
        },
        cairoFontFaces(),
      ),
    );
  };
  const pay = async (): Promise<void> => {
    if (!context) return;
    setBusy(true);
    const r = await paySalary(context, { employeeId: worker.id, month, cashAccountId: account });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.code === 'MONTH_PAID' ? t.monthPaid : t.failed);
  };
  const rows: [string, number, string][] = [
    [t.gross, slip.gross, 'gross'],
    [t.totalAdvances, slip.advancesTotal, 'advances'],
    [t.totalDeductions, slip.deductionsTotal, 'deductions'],
    [t.carryIn, slip.carryIn, 'carryin'],
  ];
  return (
    <div className={styles.form}>
      <div className={styles.section} data-testid="salary-slip">
        {rows.map(([label, value, k]) => (
          <div key={k} className={styles.kv}>
            <span>{label}</span>
            <b data-testid={`slip-${k}`}>{formatMoney(value)}</b>
          </div>
        ))}
        <div className={styles.kv}>
          <span>{t.net}</span>
          <b data-testid="slip-net">{formatMoney(slip.net)}</b>
        </div>
        {slip.carryOut > 0 && (
          <div className={styles.kv}>
            <span>{t.carriesOut}</span>
            <b data-testid="slip-carry-out">{formatMoney(slip.carryOut)}</b>
          </div>
        )}
        {slip.net > 0 &&
          !done &&
          (accounts.length === 0 ? (
            <BigAlert tone="warn" word={t.noAccount} sound={false} />
          ) : (
            <AccountSelect accounts={accounts} value={account} onChange={setAccount} />
          ))}
      </div>
      {error && <BigAlert tone="danger" word={error} />}
      {done && <BigAlert tone="ok" word={t.saved} sound={false} />}
      <div className={styles.actions}>
        {!done ? (
          <ActionButton
            label={t.confirm}
            variant="ok"
            loading={busy}
            disabled={slip.net > 0 && !account}
            onClick={() => void pay()}
            testId="confirm-salary"
          />
        ) : (
          <>
            <ActionButton label={t.print} variant="soft" onClick={() => void print()} testId="print-slip" />
            <ActionButton label={strings.common.close} variant="ghost" onClick={onDone} />
          </>
        )}
      </div>
    </div>
  );
}

function Statement({ entries }: { entries: Parameters<typeof payrollState>[0] }) {
  type Row = (typeof entries)[number];
  const rows = entries
    .filter((e) => e.status === 'posted')
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const columns: Column<Row>[] = [
    { key: 'date', header: t.date, cell: (r) => <span dir="ltr">{cairoTime(r.issuedAt)}</span> },
    { key: 'kind', header: t.kind, cell: (r) => t.kinds[r.kind as PayrollKind] },
    { key: 'month', header: t.monthCol, cell: (r) => <span dir="ltr">{r.month}</span> },
    { key: 'amount', header: t.amount, numeric: true, cell: (r) => formatMoney(r.amount) },
  ];
  if (rows.length === 0) return <p>{t.noEntries}</p>;
  return (
    <DataTable
      label={t.statement}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.issuedAt + r.kind + r.amount}
    />
  );
}
