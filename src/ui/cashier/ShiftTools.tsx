import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRightLeft, ClipboardList, Lock, Minus, Plus, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import {
  closeShift,
  postCashTransfer,
  postExpense,
  previewClose,
  type ClosePreview,
} from '@/db/commands/cash';
import { formatMoney, toPiasters } from '@/domain/money';
import { DEFAULT_DENOMINATIONS } from '@/domain/payments';
import { countByDenomination } from '@/domain/shift';
import type { Action } from '@/domain/permissions';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { play } from '../sound';
import { strings } from '../strings.ar';

import { NumEntry } from './NumEntry';
import styles from './dialogs.module.css';

type Digits = (t: string) => string;
type Ask = (action: Action) => Promise<string | null>;

export type ShiftTool = 'x' | 'expense' | 'transfer' | 'close';

/** One menu instead of four toolbar buttons: the shift's own tools. */
export function ShiftMenuDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (t: ShiftTool) => void;
  onClose: () => void;
}) {
  const { can } = useSession();
  const items = [
    { key: 'x', icon: ClipboardList, label: strings.shift.showX, shown: true },
    { key: 'expense', icon: Wallet, label: strings.cash.expense, shown: can('recordExpense') !== 'no' },
    {
      key: 'transfer',
      icon: ArrowRightLeft,
      label: strings.cash.transfer,
      shown: can('cashTransfer') !== 'no',
    },
    { key: 'close', icon: Lock, label: strings.shift.close, shown: true },
  ] as const;
  return (
    <Dialog title={strings.sell.shiftOpen} open={open} onClose={onClose}>
      <div className={styles.reasons}>
        {items
          .filter((i) => i.shown)
          .map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              className={styles.reason}
              onClick={() => onPick(key)}
              data-testid={`shift-${key}`}
            >
              <Icon size={32} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
      </div>
    </Dialog>
  );
}

export function ExpenseDialog({
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
  digits: Digits;
  onClose: () => void;
  onDone: (expenseId: string) => void;
}) {
  const { db } = useServices();
  const { context } = useSession();
  const categories = useLiveQuery(
    async () => (await db.expenseCategories.toArray()).filter((c) => !c.deletedAt),
    [db, open],
  );
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the category dialog also reports `close` right after a pick; that must not cancel the expense
  const chose = useRef(false);
  const close = (): void => {
    chose.current = false;
    setCategoryId(null);
    setError(null);
    onClose();
  };
  const save = async (text: string): Promise<void> => {
    const amount = toPiasters(text);
    const category = categoryId;
    chose.current = false;
    setCategoryId(null);
    if (!context || !category || !amount.ok || amount.value <= 0) return;
    const r = await postExpense(context, {
      categoryId: category,
      amount: amount.value,
      cashAccountId,
      shiftId,
    });
    if (r.ok) {
      play('done');
      onDone(r.id);
    } else {
      play('error');
      setError(r.code === 'DRAWER_SHORT' ? strings.cash.drawerShort : strings.cash.failed);
    }
  };
  void digits;
  return (
    <>
      <Dialog
        title={strings.cash.expenseTitle}
        open={open && categoryId === null}
        onClose={() => !chose.current && close()}
      >
        {error && <BigAlert tone="danger" word={error} sound={false} />}
        {categories && categories.length === 0 ? (
          <EmptyState icon={Wallet} word={strings.cash.noCategories} />
        ) : (
          <>
            <p className={styles.lead}>{strings.cash.category}</p>
            <div className={styles.reasons}>
              {(categories ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={styles.reason}
                  onClick={() => {
                    chose.current = true;
                    setCategoryId(c.id);
                  }}
                  data-testid={`expense-cat-${c.name}`}
                >
                  <Wallet size={32} aria-hidden="true" />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Dialog>
      <NumEntry
        title={strings.cash.amount}
        open={open && categoryId !== null}
        decimals={2}
        onCancel={close}
        onSubmit={(t) => void save(t)}
      />
    </>
  );
}

export function TransferDialog({
  open,
  shiftId,
  cashAccountId,
  onClose,
  onDone,
}: {
  open: boolean;
  shiftId: string;
  cashAccountId: string;
  onClose: () => void;
  onDone: (transferId: string) => void;
}) {
  const { db } = useServices();
  const { context } = useSession();
  const safe = useLiveQuery(
    async () => (await db.cashAccounts.filter((a) => a.kind === 'safe' && !a.deletedAt).first()) ?? null,
    [db],
  );
  const [error, setError] = useState<string | null>(null);
  const save = async (text: string): Promise<void> => {
    const amount = toPiasters(text);
    if (!context || !safe || !amount.ok || amount.value <= 0) return;
    const r = await postCashTransfer(context, {
      fromAccountId: cashAccountId,
      toAccountId: safe.id,
      amount: amount.value,
      shiftId,
    });
    if (r.ok) {
      play('done');
      setError(null);
      onDone(r.id);
    } else {
      play('error');
      setError(r.code === 'DRAWER_SHORT' ? strings.cash.drawerShort : strings.cash.failed);
    }
  };
  return (
    <>
      <NumEntry
        title={strings.cash.transferTitle}
        open={open && safe !== null && safe !== undefined}
        decimals={2}
        hint={error ? <BigAlert tone="danger" word={error} sound={false} /> : undefined}
        onCancel={() => {
          setError(null);
          onClose();
        }}
        onSubmit={(t) => void save(t)}
      />
      <Dialog title={strings.cash.transferTitle} open={open && safe === null} onClose={onClose}>
        <BigAlert tone="warn" word={strings.cash.noSafe} sound={false} />
      </Dialog>
    </>
  );
}

/** FIN-02: the cashier counts every note and coin BEFORE seeing what the drawer should hold. */
export function CloseShiftDialog({
  open,
  shiftId,
  digits,
  ask,
  onClose,
  onClosed,
}: {
  open: boolean;
  shiftId: string;
  digits: Digits;
  ask: Ask;
  onClose: () => void;
  onClosed: (shiftId: string) => void;
}) {
  return (
    <Dialog title={strings.shift.close} open={open} onClose={onClose}>
      <Body shiftId={shiftId} digits={digits} ask={ask} onClosed={onClosed} />
    </Dialog>
  );
}

function Body({
  shiftId,
  digits,
  ask,
  onClosed,
}: {
  shiftId: string;
  digits: Digits;
  ask: Ask;
  onClosed: (id: string) => void;
}) {
  const session = useSession();
  const { context } = session;
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parts = DEFAULT_DENOMINATIONS.map((value) => ({ value, count: counts[value] ?? 0 }));
  const total = countByDenomination(parts);
  const step = (value: number, delta: number): void =>
    setCounts((c) => ({ ...c, [value]: Math.max(0, (c[value] ?? 0) + delta) }));

  const show = async (): Promise<void> => {
    if (!context) return;
    const r = await previewClose(context, shiftId, parts);
    if (r.ok) setPreview(r.preview);
    else setError(strings.shift.failed);
  };
  const finish = async (): Promise<void> => {
    if (!context || !preview) return;
    let token: string | undefined;
    if (preview.needsApproval && session.can('shiftVarianceApprove') !== 'yes') {
      const t = await ask('shiftVarianceApprove');
      if (!t) return;
      token = t;
    }
    const r = await closeShift(context, { shiftId, counted: parts, note, approvalToken: token });
    if (r.ok) {
      play('done');
      onClosed(shiftId);
    } else {
      play('error');
      setError(r.code === 'NOTE_REQUIRED' ? strings.shift.note1 : strings.shift.failed);
    }
  };

  if (preview) {
    const word =
      preview.variance === 0
        ? strings.shift.match
        : preview.variance < 0
          ? strings.shift.short
          : strings.shift.over;
    return (
      <div className={styles.stack}>
        <BigAlert
          tone={preview.variance === 0 ? 'ok' : preview.needsApproval ? 'danger' : 'warn'}
          word={word}
          sound={false}
        />
        <div className={styles.info}>
          <span>
            {strings.shift.expected}
            <strong data-testid="close-expected">{digits(formatMoney(preview.expected))}</strong>
          </span>
          <span>
            {strings.shift.counted}
            <strong>{digits(formatMoney(preview.counted))}</strong>
          </span>
          <span>
            {strings.shift.variance}
            <strong data-testid="close-variance">{digits(formatMoney(preview.variance))}</strong>
          </span>
        </div>
        {preview.needsApproval && (
          <>
            <p className={styles.lead}>{strings.shift.needManager}</p>
            <input
              className="control"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={strings.shift.note}
              placeholder={strings.shift.note}
              data-testid="close-note"
            />
          </>
        )}
        {error && <BigAlert tone="danger" word={error} sound={false} />}
        <ActionButton
          big
          variant="ok"
          label={strings.shift.closeNow}
          onClick={() => void finish()}
          testId="close-confirm"
        />
        <ActionButton big variant="ghost" label={strings.common.back} onClick={() => setPreview(null)} />
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{strings.shift.countHint}</p>
      <ul className={styles.list}>
        {DEFAULT_DENOMINATIONS.map((value) => (
          <li key={value} className={styles.item} data-testid={`denom-${value}`}>
            <strong>{digits(formatMoney(value))}</strong>
            <ActionButton
              big
              icon={Minus}
              label=""
              variant="ghost"
              onClick={() => step(value, -1)}
              testId={`denom-${value}-minus`}
            />
            <strong data-testid={`denom-${value}-count`}>{digits(String(counts[value] ?? 0))}</strong>
            <ActionButton
              big
              icon={Plus}
              label=""
              variant="ghost"
              onClick={() => step(value, 1)}
              testId={`denom-${value}-plus`}
            />
          </li>
        ))}
      </ul>
      <div className={styles.info} style={{ gridTemplateColumns: '1fr' }}>
        <span>
          {strings.shift.countedSoFar}
          <strong data-testid="counted-so-far">{digits(formatMoney(total))}</strong>
        </span>
      </div>
      {error && <BigAlert tone="danger" word={error} sound={false} />}
      <ActionButton
        big
        variant="ok"
        label={strings.shift.done}
        onClick={() => void show()}
        testId="count-done"
      />
    </div>
  );
}
