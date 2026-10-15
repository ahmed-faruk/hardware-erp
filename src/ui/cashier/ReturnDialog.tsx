import { useLiveQuery } from 'dexie-react-hooks';
import { Minus, PackageCheck, PackageX, Plus, Receipt, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postSalesReturn, type PostedDoc } from '@/db/commands/returns';
import { loadSoldReturned, postedReturnLines } from '@/db/returnable';
import { searchProducts } from '@/db/search';
import type { Product } from '@/db/types';
import { formatMoney, formatQty, toPiasters } from '@/domain/money';
import type { Action } from '@/domain/permissions';
import { cairoTime } from '@/domain/receipt';
import { computeReturnLine, returnableOf, type PriorReturn } from '@/domain/returns';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { NumPad } from '../components/NumPad';
import { play } from '../sound';
import { strings } from '../strings.ar';

import { NumEntry } from './NumEntry';
import styles from './dialogs.module.css';

type Digits = (t: string) => string;
type Cond = 'good' | 'damaged';

interface Props {
  open: boolean;
  shiftId: string;
  cashAccountId: string;
  digits: Digits;
  ask: (action: Action) => Promise<string | null>;
  /** a receipt barcode the scanner read while this dialog is open */
  scanned: string | null;
  onClose: () => void;
  onDone: (posted: PostedDoc) => void;
}

const money = (d: Digits, p: number): string => d(formatMoney(p));

export function ReturnDialog(props: Props) {
  return (
    <Dialog title={strings.returns.title} open={props.open} onClose={props.onClose}>
      <Body {...props} />
    </Dialog>
  );
}

function Body({ shiftId, cashAccountId, digits, ask, scanned, onClose, onDone }: Props) {
  const { db } = useServices();
  const { worker } = useSession();
  const isManager = worker?.role === 'manager';
  const [pickedId, setInvoiceId] = useState<string | null>(null);
  const [free, setFree] = useState(false);
  const [typed, setTyped] = useState('');
  const [find, setFind] = useState('');
  const [limit, setLimit] = useState(12);
  const customers = useLiveQuery(
    async () => new Map((await db.customers.toArray()).map((c) => [c.id, c.name])),
    [db],
  );

  const invoices = useLiveQuery(
    async () => (await db.salesInvoices.toArray()).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    [db],
  );
  // a scanned receipt opens its invoice directly (until the cashier steps back from it)
  const [dismissed, setDismissed] = useState<string | null>(null);
  const scanActive = scanned !== null && scanned !== dismissed;
  const scannedId = scanActive
    ? invoices?.find((i) => i.number === scanned && i.status === 'posted')?.id
    : undefined;
  const invoiceId = pickedId ?? scannedId ?? null;
  const error = scanActive && invoices && !scannedId ? strings.returns.notFound : null;

  if (free && isManager)
    return (
      <FreeReturn
        shiftId={shiftId}
        cashAccountId={cashAccountId}
        digits={digits}
        onDone={onDone}
        onBack={() => setFree(false)}
      />
    );
  if (invoiceId)
    return (
      <InvoiceReturn
        invoiceId={invoiceId}
        shiftId={shiftId}
        cashAccountId={cashAccountId}
        digits={digits}
        ask={ask}
        onDone={onDone}
        onBack={() => {
          setInvoiceId(null);
          setDismissed(scanned);
        }}
      />
    );

  // every invoice on this device can be found: by the last digits of its number, or by the customer's name or the date
  const needle = find.trim().toLowerCase();
  const matching = (invoices ?? []).filter(
    (i) =>
      i.status === 'posted' &&
      (!typed || i.number.replace(/\D/g, '').endsWith(typed)) &&
      (!needle ||
        `${i.number} ${(i.customerId && customers?.get(i.customerId)) || ''} ${cairoTime(i.issuedAt)}`
          .toLowerCase()
          .includes(needle)),
  );
  const shown = matching.slice(0, limit);
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{strings.returns.pickInvoice}</p>
      {error && <BigAlert tone="danger" word={error} sound={false} />}
      <div
        className={styles.phone}
        dir="ltr"
        aria-label={strings.returns.invoiceDigits}
        data-testid="invoice-digits"
      >
        {typed || strings.returns.invoiceDigits}
      </div>
      <input
        className="control"
        type="search"
        value={find}
        onChange={(e) => {
          setFind(e.target.value);
          setLimit(12);
        }}
        aria-label={strings.returns.find}
        placeholder={strings.returns.find}
        data-testid="return-find"
      />
      <NumPad
        onDigit={(d) => setTyped((t) => (t.length < 6 ? t + d : t))}
        onBackspace={() => setTyped((t) => t.slice(0, -1))}
        onOk={() => shown.length === 1 && setInvoiceId(shown[0]!.id)}
      />
      {invoices && shown.length === 0 ? (
        <EmptyState icon={Receipt} word={strings.sell.noRecent} />
      ) : (
        <ul className={styles.list}>
          {shown.map((inv) => (
            <li key={inv.id} className={styles.item}>
              <span dir="ltr">{digits(inv.number)}</span>
              <strong>{money(digits, inv.total)}</strong>
              <ActionButton
                big
                label={strings.returns.button}
                onClick={() => setInvoiceId(inv.id)}
                testId={`return-${inv.number}`}
              />
            </li>
          ))}
        </ul>
      )}
      {matching.length > shown.length && (
        <ActionButton
          big
          variant="ghost"
          label={strings.returns.more}
          onClick={() => setLimit((n) => n + 12)}
          testId="return-more"
        />
      )}
      {isManager && (
        <ActionButton
          big
          variant="ghost"
          label={strings.returns.withoutInvoice}
          onClick={() => setFree(true)}
          testId="return-free"
        />
      )}
      <ActionButton big variant="ghost" label={strings.common.cancel} onClick={onClose} />
    </div>
  );
}

function InvoiceReturn({
  invoiceId,
  shiftId,
  cashAccountId,
  digits,
  ask,
  onDone,
  onBack,
}: Pick<Props, 'shiftId' | 'cashAccountId' | 'digits' | 'ask' | 'onDone'> & {
  invoiceId: string;
  onBack: () => void;
}) {
  const { db } = useServices();
  const { context } = useSession();
  const data = useLiveQuery(async () => {
    const lines = await db.salesInvoiceLines.where('invoiceId').equals(invoiceId).sortBy('lineNo');
    const prior = await postedReturnLines(
      db,
      lines.map((l) => l.id),
    );
    const products = await db.products.bulkGet(lines.map((l) => l.productId ?? ''));
    return { lines, prior, products };
  }, [db, invoiceId]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cond, setCond] = useState<Record<string, Cond>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;

  const priors: PriorReturn[] = data.prior.map((r) => ({
    originalLineId: r.originalLineId as string,
    qtyMilli: r.qty as number,
  }));
  const rows = data.lines.map((l, i) => {
    const sold = {
      id: l.id,
      qtyMilli: l.qty,
      finalAmount: l.netAmount - l.allocDiscount,
      unitCost: l.unitCost,
    };
    const already = priors.filter((p) => p.originalLineId === l.id).reduce((a, p) => a + p.qtyMilli, 0);
    const left = l.qty - already;
    const q = qty[l.id] ?? 0;
    const calc = q > 0 ? computeReturnLine(sold, priors, q) : null;
    return {
      l,
      name: data.products[i]?.name ?? l.legacyText ?? '',
      already,
      left,
      q,
      refund: calc && calc.ok ? calc.refund : 0,
    };
  });
  const total = rows.reduce((a, r) => a + r.refund, 0);
  const step = (id: string, left: number, delta: number): void =>
    setQty((m) => ({ ...m, [id]: Math.max(0, Math.min(left, (m[id] ?? 0) + delta)) }));

  const confirm = async (): Promise<void> => {
    if (!context || total <= 0) return;
    setBusy(true);
    setError(null);
    const lines = rows
      .filter((r) => r.q > 0)
      .map((r) => ({ originalLineId: r.l.id, qtyMilli: r.q, condition: cond[r.l.id] ?? 'good' }));
    const base = { originalInvoiceId: invoiceId, lines, shiftId, cashAccountId };
    let r = await postSalesReturn(context, base);
    if (!r.ok && r.code === 'APPROVAL_REQUIRED') {
      const token = await ask('returnAfterPeriod');
      if (token) r = await postSalesReturn(context, { ...base, approvalTokens: [token] });
    }
    setBusy(false);
    if (r.ok) {
      play('done');
      onDone(r);
    } else {
      play('error');
      setError(
        r.code === 'DRAWER_SHORT'
          ? strings.returns.drawerShort
          : r.code === 'APPROVAL_REQUIRED'
            ? strings.returns.needsManager
            : strings.returns.failed,
      );
    }
  };

  return (
    <div className={styles.stack}>
      {rows.every((r) => r.left === 0) && (
        <BigAlert tone="warn" word={strings.returns.noneLeft} sound={false} />
      )}
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.l.id} className={styles.item} data-testid={`return-line-${r.l.lineNo}`}>
            <span>
              <strong>{r.name}</strong>
              <br />
              <small>{`${strings.returns.sold} ${digits(String(r.l.qty / 1000))} · ${strings.returns.left} ${digits(String(r.left / 1000))}`}</small>
            </span>
            {r.left > 0 && (
              <>
                <ActionButton
                  big
                  icon={Minus}
                  label=""
                  variant="ghost"
                  onClick={() => step(r.l.id, r.left, -1000)}
                  testId={`minus-${r.l.lineNo}`}
                />
                <strong data-testid={`qty-${r.l.lineNo}`}>{digits(String(r.q / 1000))}</strong>
                <ActionButton
                  big
                  icon={Plus}
                  label=""
                  variant="ghost"
                  onClick={() => step(r.l.id, r.left, 1000)}
                  testId={`plus-${r.l.lineNo}`}
                />
                <ActionButton
                  big
                  icon={(cond[r.l.id] ?? 'good') === 'good' ? PackageCheck : PackageX}
                  label={(cond[r.l.id] ?? 'good') === 'good' ? strings.returns.good : strings.returns.damaged}
                  variant={(cond[r.l.id] ?? 'good') === 'good' ? 'ok' : 'danger'}
                  onClick={() =>
                    setCond((c) => ({
                      ...c,
                      [r.l.id]: (c[r.l.id] ?? 'good') === 'good' ? 'damaged' : 'good',
                    }))
                  }
                  testId={`cond-${r.l.lineNo}`}
                />
              </>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.info}>
        <span>
          {strings.returns.refund}
          <strong data-testid="refund-total">{money(digits, total)}</strong>
        </span>
      </div>
      {error && <BigAlert tone="danger" word={error} />}
      <ActionButton
        big
        variant="ok"
        label={strings.returns.confirm}
        loading={busy}
        disabled={total <= 0}
        onClick={() => void confirm()}
        testId="confirm-return"
      />
      <ActionButton big variant="ghost" label={strings.common.back} onClick={onBack} />
    </div>
  );
}

interface FreeItem {
  product: Product;
  price: number;
  qty: number;
  cond: Cond;
}

/** Manager: a return without invoice with many lines. Only products that were sold before can be picked, never above sold - returned. */
function FreeReturn({
  shiftId,
  cashAccountId,
  digits,
  onDone,
  onBack,
}: Pick<Props, 'shiftId' | 'cashAccountId' | 'digits' | 'onDone'> & { onBack: () => void }) {
  const { db } = useServices();
  const session = useSession();
  const { context } = session;
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [items, setItems] = useState<FreeItem[]>([]);
  const [draft, setDraft] = useState<FreeItem | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = useLiveQuery(() => loadSoldReturned(db), [db]);
  useEffect(() => {
    void searchProducts(db, text, { limit: 40 }).then(setFound);
  }, [db, text]);
  if (session.can('returnWithoutInvoice') !== 'yes') return null;

  // what is still returnable of a product, after the lines already in this document
  const left = (id: string, except?: FreeItem): number =>
    returnableOf(totals?.get(id)) -
    items.filter((x) => x !== except && x.product.id === id).reduce((a, x) => a + x.qty, 0);
  const soldProducts = found.filter((p) => returnableOf(totals?.get(p.id)) > 0);
  const lineTotal = (x: FreeItem): number => Math.round((x.price * x.qty) / 1000);
  const total = items.reduce((a, x) => a + lineTotal(x), 0);

  const confirm = async (): Promise<void> => {
    if (!context || items.length === 0) return;
    setError(null);
    const r = await postSalesReturn(context, {
      originalInvoiceId: null,
      lines: items.map((x) => ({
        originalLineId: null,
        productId: x.product.id,
        qtyMilli: x.qty,
        unitRefund: x.price,
        condition: x.cond,
      })),
      reason: 'other',
      shiftId,
      cashAccountId,
    });
    if (r.ok) return onDone(r);
    setError(
      r.code === 'DRAWER_SHORT'
        ? strings.returns.drawerShort
        : r.code === 'NOT_SOLD'
          ? strings.returns.notSold
          : r.code === 'OVER_SOLD'
            ? strings.returns.overSold
            : strings.returns.failed,
    );
  };

  if (draft) {
    const max = left(draft.product.id);
    return (
      <div className={styles.stack}>
        <p className={styles.lead}>{draft.product.name}</p>
        <p data-testid="free-available">
          {strings.returns.available}: {digits(formatQty(max))}
        </p>
        <div className={styles.item}>
          <ActionButton
            big
            icon={Minus}
            label=""
            variant="ghost"
            onClick={() => setDraft({ ...draft, qty: Math.max(1000, draft.qty - 1000) })}
          />
          <strong data-testid="free-qty">{digits(formatQty(draft.qty))}</strong>
          <ActionButton
            big
            icon={Plus}
            label=""
            variant="ghost"
            disabled={draft.qty + 1000 > max}
            onClick={() => setDraft({ ...draft, qty: draft.qty + 1000 })}
          />
          <ActionButton
            big
            label={`${strings.returns.price}: ${money(digits, draft.price)}`}
            variant="ghost"
            onClick={() => setPriceOpen(true)}
            testId="free-price"
          />
          <ActionButton
            big
            icon={draft.cond === 'good' ? PackageCheck : PackageX}
            label={draft.cond === 'good' ? strings.returns.good : strings.returns.damaged}
            variant={draft.cond === 'good' ? 'ok' : 'danger'}
            onClick={() => setDraft({ ...draft, cond: draft.cond === 'good' ? 'damaged' : 'good' })}
          />
        </div>
        <div className={styles.info}>
          <span>
            {strings.returns.refund}
            <strong>{money(digits, lineTotal(draft))}</strong>
          </span>
        </div>
        <ActionButton
          big
          variant="ok"
          label={strings.returns.addLine}
          disabled={lineTotal(draft) <= 0 || draft.qty > max}
          onClick={() => {
            setItems((list) => [...list, draft]);
            setDraft(null);
            setText('');
          }}
          testId="free-add"
        />
        <ActionButton big variant="ghost" label={strings.common.back} onClick={() => setDraft(null)} />
        <NumEntry
          title={strings.returns.price}
          open={priceOpen}
          decimals={2}
          onCancel={() => setPriceOpen(false)}
          onSubmit={(t) => {
            const p = toPiasters(t);
            if (p.ok) setDraft({ ...draft, price: p.value });
            setPriceOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{strings.returns.pickProduct}</p>
      <input
        className="control"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={strings.returns.pickProduct}
        data-testid="free-search"
      />
      {text.trim() && totals && soldProducts.length === 0 && (
        <BigAlert tone="warn" word={strings.returns.notSold} sound={false} />
      )}
      <ul className={styles.list}>
        {soldProducts.slice(0, 8).map((p) => (
          <li key={p.id} className={styles.item}>
            <span>{p.name}</span>
            <ActionButton
              big
              label={strings.returns.button}
              disabled={left(p.id) <= 0}
              onClick={() =>
                setDraft({ product: p, price: p.price, qty: Math.min(1000, left(p.id)), cond: 'good' })
              }
              testId={`free-${p.sku ?? p.id}`}
            />
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <>
          <p className={styles.lead}>{strings.returns.lines}</p>
          <ul className={styles.list} data-testid="free-lines">
            {items.map((x, i) => (
              <li key={`${x.product.id}-${i}`} className={styles.item} data-testid={`free-line-${i}`}>
                <span>
                  {x.product.name} × {digits(formatQty(x.qty))}
                </span>
                <strong>{money(digits, lineTotal(x))}</strong>
                <ActionButton
                  big
                  icon={Trash2}
                  label=""
                  variant="ghost"
                  onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                  testId={`free-remove-${i}`}
                />
              </li>
            ))}
          </ul>
          <div className={styles.info}>
            <span>
              {strings.returns.refund}
              <strong data-testid="free-total">{money(digits, total)}</strong>
            </span>
          </div>
        </>
      )}
      {error && <BigAlert tone="danger" word={error} />}
      <ActionButton
        big
        variant="ok"
        label={strings.returns.confirm}
        disabled={items.length === 0 || total <= 0}
        onClick={() => void confirm()}
        testId="confirm-free-return"
      />
      <ActionButton big variant="ghost" label={strings.common.back} onClick={onBack} />
    </div>
  );
}
