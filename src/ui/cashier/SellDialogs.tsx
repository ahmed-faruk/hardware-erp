import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Banknote, CircleHelp, Coins, Eye, Printer, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useServices } from '@/app/session';
import { discardCart, listHeldCarts } from '@/db/commands/carts';
import { todaysInvoices } from '@/db/invoice-search';
import { NO_SALE_REASONS, type NoSaleReason } from '@/db/commands/receipts';
import { formatMoney } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { InvoiceViewDialog } from '../components/InvoiceView';
import { focusOnPc } from '../focus';
import { strings } from '../strings.ar';

import { PauseCircle, Receipt } from 'lucide-react';
import styles from './dialogs.module.css';

export function HeldCartsDialog({
  open,
  digits,
  onResume,
  onClose,
}: {
  open: boolean;
  digits: (t: string) => string;
  onResume: (id: string) => void;
  onClose: () => void;
}) {
  const { db } = useServices();
  // each held invoice with the name of its customer (none = the no-customer word)
  const held = useLiveQuery(async () => {
    const rows = await listHeldCarts(db);
    const ids = [...new Set(rows.map((h) => h.cart.customerId).filter((x): x is string => !!x))];
    const names = new Map(
      (await db.customers.bulkGet(ids)).filter((c) => !!c).map((c) => [c!.id, c!.name] as const),
    );
    return rows.map((h) => ({
      ...h,
      customerName: h.cart.customerId ? (names.get(h.cart.customerId) ?? null) : null,
    }));
  }, [db, open]);
  const time = (iso: string): string =>
    digits(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso)),
    );
  return (
    <Dialog title={strings.sell.held} open={open} onClose={onClose}>
      {held && held.length === 0 ? (
        <EmptyState icon={PauseCircle} word={strings.sell.noHeld} />
      ) : (
        <ul className={styles.list} data-testid="held-list">
          {held?.map((h) => (
            <li key={h.id} className={styles.item}>
              <span>{time(h.heldAt)}</span>
              <span data-testid={`held-customer-${h.id}`}>
                {h.customerName ?? h.label ?? strings.sell.noCustomer}
              </span>
              <span>{`${digits(String(h.cart.lines.length))} ${strings.sell.itemsCount}`}</span>
              <strong>{digits(formatMoney(h.total))}</strong>
              <ActionButton
                big
                label={strings.sell.resume}
                onClick={() => onResume(h.id)}
                testId={`resume-${h.id}`}
              />
              <ActionButton
                big
                label={strings.sell.dropped}
                icon={Trash2}
                variant="ghost"
                onClick={() => void discardCart(db, h.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function RecentInvoicesDialog({
  open,
  digits,
  onReprint,
  onVoid,
  onVoidReturn,
  onClose,
}: {
  open: boolean;
  digits: (t: string) => string;
  onReprint: (id: string) => void;
  /** only passed for a manager */
  onVoid?: (id: string) => void;
  /** only passed for a manager who may void a return */
  onVoidReturn?: (returnId: string) => void;
  onClose: () => void;
}) {
  const { db, identity } = useServices();
  const [viewId, setViewId] = useState<string | null>(null);
  // every invoice of today (Cairo day) made on THIS device, from any shift, newest first
  const invoices = useLiveQuery(() => todaysInvoices(db, identity.deviceId), [db, identity.deviceId, open]);
  return (
    <>
      <Dialog title={strings.invoiceSearch.todayTitle} open={open} onClose={onClose}>
        {invoices && invoices.length === 0 ? (
          <EmptyState icon={Receipt} word={strings.invoiceSearch.todayNone} />
        ) : (
          <ul className={styles.list}>
            {invoices?.map((inv) => (
              <li key={inv.id} className={styles.item} data-testid={`recent-${inv.number}`}>
                <span dir="ltr">{digits(inv.number)}</span>
                {inv.status === 'voided' && (
                  <strong data-testid={`voided-${inv.number}`}>{strings.invoiceSearch.voidedMark}</strong>
                )}
                <strong>{digits(formatMoney(inv.total))}</strong>
                <ActionButton
                  big
                  label={strings.invoiceView.view}
                  icon={Eye}
                  variant="ghost"
                  onClick={() => setViewId(inv.id)}
                  testId={`view-${inv.number}`}
                />
                <ActionButton
                  big
                  label={strings.sell.reprint}
                  icon={Printer}
                  onClick={() => onReprint(inv.id)}
                  testId={`reprint-${inv.number}`}
                />
                {onVoid && inv.status === 'posted' && (
                  <ActionButton
                    big
                    label={strings.voidInvoice.button}
                    icon={Ban}
                    variant="danger"
                    onClick={() => onVoid(inv.id)}
                    testId={`void-${inv.number}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <InvoiceViewDialog
        kind="sale"
        invoiceId={viewId}
        onClose={() => setViewId(null)}
        onVoidReturn={
          onVoidReturn
            ? (id) => {
                setViewId(null);
                onVoidReturn(id);
              }
            : undefined
        }
      />
    </>
  );
}

const REASON_ICON = { change: Coins, wrongChange: Undo2, cashCheck: Banknote, other: CircleHelp } as const;

/** The drawer opens when the slip prints. A fixed list of reasons with icons, so nobody has to type. */
export function NoSaleDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (reason: NoSaleReason) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={strings.sell.noSale} open={open} onClose={onClose}>
      <p className={styles.lead}>{strings.sell.reason}</p>
      <div className={styles.reasons}>
        {NO_SALE_REASONS.map((r) => {
          const Icon = REASON_ICON[r];
          return (
            <button
              key={r}
              type="button"
              className={styles.reason}
              onClick={() => onPick(r)}
              data-testid={`reason-${r}`}
            >
              <Icon size={32} aria-hidden="true" />
              <span>{strings.receipt.noSaleReasons[r]}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/** The manager picks why the invoice is cancelled from a fixed list: no typing, no "are you sure" (UX-09). */

/** Holding an invoice that has no customer: an optional written name so the cashier finds it again (owner decision 2026-10-22). */
export function HoldNameDialog({
  open,
  onHold,
  onClose,
}: {
  open: boolean;
  onHold: (label: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={strings.sell.hold} open={open} onClose={onClose}>
      <HoldNameBody onHold={onHold} />
    </Dialog>
  );
}

function HoldNameBody({ onHold }: { onHold: (label: string | null) => void }) {
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => focusOnPc(field.current), []);
  return (
    <form
      className={styles.stack}
      onSubmit={(e) => {
        e.preventDefault();
        onHold(name.trim() || null);
      }}
    >
      <input
        ref={field}
        className="control"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        aria-label={strings.sell.holdName}
        placeholder={strings.sell.holdName}
        data-testid="hold-name"
      />
      <ActionButton big label={strings.sell.hold} type="submit" variant="ok" testId="hold-confirm" />
    </form>
  );
}
