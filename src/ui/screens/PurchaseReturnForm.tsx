import { useLiveQuery } from 'dexie-react-hooks';
import { ListChecks, Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postPurchaseReturn } from '@/db/commands/purchasing';
import { lastPurchaseLine } from '@/db/purchase-return';
import type { Product } from '@/db/types';
import { formatMoney, formatQty, mulDivRound, toPiasters } from '@/domain/money';
import { defaultReturnValue } from '@/domain/purchase-return';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { ProductPicker } from '../components/ProductPicker';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { SupplierSelect, useBasics } from './purchaseParts';
import styles from './screens.module.css';

type Mode = 'invoices' | 'plain';
interface PlainLine {
  product: Product;
  qty: number;
  /** null = the last price from this supplier (the default); a number only for a holder of editReturnValue */
  net: number | null;
  standard: number;
}

const t = strings.purchases;

/**
 * A purchase return, easy: pick the supplier first; then either tick quantities on any of his invoices (several invoices in
 * one return) or, without an invoice, pick products. The value of a plain line is the last price from this supplier.
 */
export function PurchaseReturnForm({ onDone }: { onDone: () => void }) {
  const { db } = useServices();
  const { context, can } = useSession();
  const basics = useBasics();
  const [supplierId, setSupplierId] = useState('');
  const [mode, setMode] = useState<Mode>('invoices');
  const [find, setFind] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [plain, setPlain] = useState<PlainLine[]>([]);
  const [toCash, setToCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPlain = can('purchaseReturnWithoutInvoice') === 'yes';
  const canEditValue = can('editReturnValue') === 'yes';

  // the supplier's posted invoices, each with its lines and what is still returnable of every line
  const invoices = useLiveQuery(async () => {
    if (!supplierId) return [];
    const list = (
      await db.purchaseInvoices.filter((i) => i.supplierId === supplierId && i.status === 'posted').toArray()
    ).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    const lines = await db.purchaseInvoiceLines
      .where('invoiceId')
      .anyOf(list.map((i) => i.id))
      .toArray();
    const prior = await db.purchaseReturnLines
      .where('originalLineId')
      .anyOf(lines.map((l) => l.id))
      .toArray();
    const products = await db.products.bulkGet(lines.map((l) => (l.productId as string | null) ?? ''));
    return list.map((inv) => ({
      inv,
      lines: lines
        .map((l, i) => ({ l, name: products[i]?.name ?? '' }))
        .filter((x) => x.l.invoiceId === inv.id)
        .map((x) => ({
          id: x.l.id,
          name: x.name,
          qty: x.l.qty as number,
          net: x.l.netAmount as number,
          left:
            (x.l.qty as number) -
            prior.filter((p) => p.originalLineId === x.l.id).reduce((a, p) => a + (p.qty as number), 0),
        })),
    }));
  }, [db, supplierId]);

  if (!basics || !invoices) return <Skeleton />;

  const needle = find.trim().toLowerCase();
  const shown = needle
    ? invoices.filter((x) => `${x.inv.number} ${cairoTime(x.inv.issuedAt)}`.toLowerCase().includes(needle))
    : invoices;
  const lineValue = (net: number, whole: number, q: number): number => mulDivRound(net, q, whole);
  const picked = invoices.flatMap((x) =>
    x.lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ ...l, take: qty[l.id]! })),
  );
  const invoicesTotal = picked.reduce((a, l) => a + lineValue(l.net, l.qty, l.take), 0);
  const plainTotal = plain.reduce((a, l) => a + (l.net ?? l.standard), 0);
  const total = mode === 'invoices' ? invoicesTotal : plainTotal;

  const step = (id: string, left: number, delta: number): void =>
    setQty((m) => ({ ...m, [id]: Math.max(0, Math.min(left, (m[id] ?? 0) + delta)) }));

  const addPlain = async (product: Product): Promise<void> => {
    const last = await lastPurchaseLine(db, supplierId, product.id);
    const standard = defaultReturnValue(last, product.unitCost, 1000);
    setPlain((list) => [...list, { product, qty: 1000, net: null, standard }]);
  };
  const setPlainQty = async (i: number, qtyMilli: number): Promise<void> => {
    const item = plain[i];
    if (!item) return;
    const last = await lastPurchaseLine(db, supplierId, item.product.id);
    const standard = defaultReturnValue(last, item.product.unitCost, qtyMilli);
    setPlain((list) => list.map((x, j) => (j === i ? { ...x, qty: qtyMilli, standard, net: null } : x)));
  };

  const save = async (): Promise<void> => {
    if (!context || !basics.warehouse || total <= 0) return;
    if (toCash && !basics.safe) return setError(t.noSafe);
    setBusy(true);
    setError(null);
    const base = {
      supplierId,
      warehouseId: basics.warehouse.id,
      refundTo: toCash ? ('cash' as const) : ('credit' as const),
      cashAccountId: toCash ? basics.safe!.id : null,
      lines:
        mode === 'invoices'
          ? picked.map((l) => ({ originalLineId: l.id, qtyMilli: l.take }))
          : plain.map((x) => ({
              originalLineId: null,
              productId: x.product.id,
              qtyMilli: x.qty,
              netAmount: x.net,
            })),
    };
    const r = await postPurchaseReturn(context, base);
    setBusy(false);
    if (r.ok) onDone();
    else setError(t.returnFailed);
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <SupplierSelect
          value={supplierId}
          onChange={(id) => {
            setSupplierId(id);
            setQty({});
            setPlain([]);
          }}
          suppliers={basics.suppliers}
        />
        {canPlain && (
          <SegmentedControl
            label={t.newReturn}
            options={[
              { key: 'invoices', label: t.returnByInvoices },
              { key: 'plain', label: t.returnPlain },
            ]}
            value={mode}
            onChange={setMode}
            testIdPrefix="return-mode-"
          />
        )}
      </div>

      {supplierId && mode === 'invoices' && (
        <>
          <FormField label={t.findInvoice}>
            {(id) => (
              <input
                id={id}
                className="control"
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                data-testid="return-find"
              />
            )}
          </FormField>
          {shown.length === 0 && <p>{t.noInvoicesForSupplier}</p>}
          {shown.map(({ inv, lines }) => (
            <div key={inv.id} className={styles.section} data-testid={`return-invoice-${inv.number}`}>
              <h2>
                <span dir="ltr">{inv.number}</span> —{' '}
                <span dir="ltr">{cairoTime(inv.issuedAt).slice(0, 10)}</span> —{' '}
                {formatMoney(inv.total as number)}
              </h2>
              <ActionButton
                icon={ListChecks}
                variant="ghost"
                label={t.returnAll}
                disabled={lines.every((l) => l.left === 0)}
                onClick={() =>
                  setQty((m) => ({
                    ...m,
                    ...Object.fromEntries(lines.filter((l) => l.left > 0).map((l) => [l.id, l.left])),
                  }))
                }
                testId={`rt-all-${inv.number}`}
              />
              {lines.map((l) => (
                <div key={l.id} className={styles.row}>
                  <span>
                    {l.name} · {`${t.left}: ${formatQty(l.left)}`}
                  </span>
                  <ActionButton
                    big
                    icon={Minus}
                    label=""
                    variant="ghost"
                    onClick={() => step(l.id, l.left, -1000)}
                    disabled={(qty[l.id] ?? 0) === 0}
                    testId={`rt-minus-${inv.number}-${lines.indexOf(l) + 1}`}
                  />
                  <strong data-testid={`rt-qty-${inv.number}-${lines.indexOf(l) + 1}`}>
                    {formatQty(qty[l.id] ?? 0)}
                  </strong>
                  <ActionButton
                    big
                    icon={Plus}
                    label=""
                    variant="ghost"
                    onClick={() => step(l.id, l.left, 1000)}
                    disabled={(qty[l.id] ?? 0) + 1000 > l.left}
                    testId={`rt-plus-${inv.number}-${lines.indexOf(l) + 1}`}
                  />
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {supplierId && mode === 'plain' && (
        <div className={styles.section}>
          <ProductPicker onPick={(p) => void addPlain(p)} label={t.pickProductToReturn} />
          {plain.map((x, i) => (
            <div key={`${x.product.id}-${i}`} className={styles.row} data-testid={`rt-plain-${i}`}>
              <span>{x.product.name}</span>
              <ActionButton
                big
                icon={Minus}
                label=""
                variant="ghost"
                onClick={() => void setPlainQty(i, Math.max(1000, x.qty - 1000))}
              />
              <strong>{formatQty(x.qty)}</strong>
              <ActionButton
                big
                icon={Plus}
                label=""
                variant="ghost"
                onClick={() => void setPlainQty(i, x.qty + 1000)}
              />
              {canEditValue ? (
                <NumberField
                  label={t.returnValue}
                  value={x.net ?? x.standard}
                  onChange={(v) =>
                    setPlain((list) => list.map((y, j) => (j === i ? { ...y, net: v ?? 0 } : y)))
                  }
                  parse={toPiasters}
                  format={formatMoney}
                />
              ) : (
                <strong data-testid={`rt-value-${i}`}>{formatMoney(x.standard)}</strong>
              )}
              <ActionButton
                big
                icon={Trash2}
                label=""
                variant="ghost"
                onClick={() => setPlain((list) => list.filter((_, j) => j !== i))}
                testId={`rt-remove-${i}`}
              />
            </div>
          ))}
        </div>
      )}

      {supplierId && (
        <div className={styles.section}>
          <h2 data-testid="return-total">{`${t.returnTotal}: ${formatMoney(total)}`}</h2>
          <label className={styles.check}>
            <input type="checkbox" checked={toCash} onChange={(e) => setToCash(e.target.checked)} />
            {t.refundCash}
          </label>
          {!toCash && <p>{t.refundCredit}</p>}
        </div>
      )}
      {error && <BigAlert tone="danger" word={error} />}
      <div className={styles.actions}>
        <ActionButton
          big
          label={t.save}
          variant="ok"
          loading={busy}
          disabled={total <= 0 || !supplierId}
          onClick={() => void save()}
          testId="save-purchase-return"
        />
      </div>
    </div>
  );
}
