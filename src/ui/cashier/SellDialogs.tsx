import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, CircleHelp, Coins, Printer, Trash2, Undo2 } from 'lucide-react';

import { useServices } from '@/app/session';
import { discardCart, listHeldCarts, type HeldCartRow } from '@/db/commands/carts';
import { NO_SALE_REASONS, type NoSaleReason } from '@/db/commands/receipts';
import { formatMoney } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
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
  const held = useLiveQuery(() => listHeldCarts(db), [db, open]);
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
        <ul className={styles.list}>
          {held?.map((h: HeldCartRow) => (
            <li key={h.id} className={styles.item}>
              <span>{time(h.heldAt)}</span>
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
  shiftId,
  digits,
  onReprint,
  onClose,
}: {
  open: boolean;
  shiftId: string | null;
  digits: (t: string) => string;
  onReprint: (id: string) => void;
  onClose: () => void;
}) {
  const { db } = useServices();
  const invoices = useLiveQuery(
    async () =>
      shiftId
        ? (await db.salesInvoices.where('shiftId').equals(shiftId).toArray())
            .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
            .slice(0, 30)
        : [],
    [db, shiftId, open],
  );
  return (
    <Dialog title={strings.sell.recent} open={open} onClose={onClose}>
      {invoices && invoices.length === 0 ? (
        <EmptyState icon={Receipt} word={strings.sell.noRecent} />
      ) : (
        <ul className={styles.list}>
          {invoices?.map((inv) => (
            <li key={inv.id} className={styles.item} data-testid={`recent-${inv.number}`}>
              <span dir="ltr">{digits(inv.number)}</span>
              <strong>{digits(formatMoney(inv.total))}</strong>
              <ActionButton
                big
                label={strings.sell.reprint}
                icon={Printer}
                onClick={() => onReprint(inv.id)}
                testId={`reprint-${inv.number}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
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
