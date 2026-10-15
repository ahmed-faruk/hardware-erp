import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postPurchase } from '@/db/commands/purchasing';
import type { Product, ProductUnit } from '@/db/types';
import { formatMoney, formatQty, toMilli, toPiasters } from '@/domain/money';
import { computePurchase, splitPurchasePayment } from '@/domain/purchase';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { InvoiceViewDialog } from '../components/InvoiceView';
import { NumberField } from '../components/NumberField';
import { ProductPicker } from '../components/ProductPicker';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { PurchaseReturnForm } from './PurchaseReturnForm';
import { SupplierSelect, useBasics } from './purchaseParts';
import styles from './screens.module.css';

interface Row {
  key: string;
  product: Product;
  unit: ProductUnit | null;
  qty: number | null;
  cost: number | null;
  price: number | null;
}

export function PurchasesScreen() {
  const { db } = useServices();
  const [formOpen, setFormOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const rows = useLiveQuery(async () => {
    const suppliers = new Map((await db.suppliers.toArray()).map((s) => [s.id, s.name]));
    const owner = new Map<string, number>();
    for (const pay of await db.payments
      .where('[documentType+documentId]')
      .between(['purchase_invoice', ''], ['purchase_invoice', '\uffff'])
      .toArray())
      if (pay.method === 'owner') owner.set(pay.documentId, (owner.get(pay.documentId) ?? 0) + pay.amount);
    return (await db.purchaseInvoices.toArray())
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .slice(0, 100)
      .map((p) => ({
        ...p,
        ownerPaid: owner.get(p.id) ?? 0,
        total: p.total as number,
        supplierId: p.supplierId as string,
        supplierName: suppliers.get(p.supplierId as string) ?? '',
      }));
  }, [db]);
  const [viewId, setViewId] = useState<string | null>(null);
  const print = async (id: string): Promise<void> => {
    const [{ loadPurchaseDocument }, render, { printHtml, cairoFontFaces }] = await Promise.all([
      import('@/db/purchase-document'),
      import('../print/render'),
      import('../print/printHtml'),
    ]);
    const doc = await loadPurchaseDocument(db, id);
    if (doc) await printHtml(render.renderPurchaseHtml(doc, cairoFontFaces()));
  };
  const columns: Column<NonNullable<typeof rows>[number]>[] = [
    { key: 'number', header: strings.purchases.number, cell: (p) => <span dir="ltr">{p.number}</span> },
    {
      key: 'date',
      header: strings.purchases.date,
      cell: (p) => <span dir="ltr">{cairoTime(p.issuedAt)}</span>,
    },
    { key: 'supplier', header: strings.purchases.supplier, cell: (p) => p.supplierName },
    {
      key: 'total',
      header: strings.purchases.total,
      numeric: true,
      cell: (p) => formatMoney(p.total as number),
    },
    {
      key: 'owner',
      header: strings.purchases.paidOutside,
      numeric: true,
      cell: (p) => (p.ownerPaid ? formatMoney(p.ownerPaid) : '—'),
    },
    {
      key: 'print',
      header: '',
      cell: (p) => (
        <>
          <ActionButton
            label={strings.invoiceView.view}
            icon={Eye}
            variant="ghost"
            onClick={() => setViewId(p.id)}
            testId={`view-${p.number}`}
          />
          <ActionButton
            label={strings.purchases.print}
            icon={Printer}
            variant="ghost"
            onClick={() => void print(p.id)}
            testId={`print-${p.number}`}
          />
        </>
      ),
    },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.purchases.title}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.purchases.newPurchase}
            icon={Plus}
            onClick={() => setFormOpen(true)}
            testId="new-purchase"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.purchases.newReturn}
            icon={Undo2}
            variant="ghost"
            onClick={() => setReturnOpen(true)}
            testId="new-purchase-return"
          />
        </div>
      </div>
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Plus} word={strings.purchases.noPurchases} />
      ) : (
        <DataTable label={strings.purchases.title} rows={rows} columns={columns} rowKey={(p) => p.id} />
      )}
      <InvoiceViewDialog kind="purchase" invoiceId={viewId} onClose={() => setViewId(null)} />
      <Dialog title={strings.purchases.newPurchase} open={formOpen} onClose={() => setFormOpen(false)}>
        <PurchaseForm onDone={() => setFormOpen(false)} />
      </Dialog>
      <Dialog title={strings.purchases.newReturn} open={returnOpen} onClose={() => setReturnOpen(false)}>
        <PurchaseReturnForm onDone={() => setReturnOpen(false)} />
      </Dialog>
    </section>
  );
}

function PurchaseForm({ onDone }: { onDone: () => void }) {
  const { db } = useServices();
  const session = useSession();
  const { context } = session;
  const basics = useBasics();
  const isManager = session.can('editPrices') === 'yes';
  const [supplierId, setSupplierId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [paid, setPaid] = useState<number | null>(null);
  const [ownerPaid, setOwnerPaid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!basics) return <Skeleton />;
  if (!basics.warehouse) return <BigAlert tone="warn" word={strings.purchases.noWarehouse} />;

  const valid = rows.every((r) => r.qty && r.qty > 0 && r.cost !== null);
  const totals =
    valid && rows.length > 0
      ? computePurchase(rows.map((r) => ({ qtyMilli: r.qty!, unitCost: r.cost!, discount: 0 })))
      : null;
  const total = totals?.total ?? 0;
  const mayPayOwner = session.can('payFromOwner') === 'yes';
  const ownerAmount = mayPayOwner ? (ownerPaid ?? 0) : 0;
  // by default the whole invoice leaves the safe, minus what the owner paid from his pocket
  const cashPaid = Math.min(paid ?? Math.max(0, total - ownerAmount), total);
  const split = splitPurchasePayment(total, cashPaid, ownerAmount);

  const add = async (product: Product): Promise<void> => {
    const units = await db.productUnits.where('productId').equals(product.id).toArray();
    const unit = units.find((u) => u.isDefaultPurchase) ?? null;
    setRows((r) => [
      ...r,
      { key: crypto.randomUUID(), product, unit, qty: 1000, cost: product.unitCost || null, price: null },
    ]);
  };
  const patch = (key: string, p: Partial<Row>): void =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const save = async (): Promise<void> => {
    if (!context || !supplierId || !totals) return;
    if (cashPaid > 0 && !basics.safe) return setError(strings.purchases.noSafe);
    if (!split) return setError(strings.purchases.ownerTooMuch);
    setBusy(true);
    setError(null);
    const payments = [
      ...(cashPaid > 0
        ? [{ method: 'cash' as const, amount: cashPaid, cashAccountId: basics.safe!.id }]
        : []),
      ...(split.owner > 0 ? [{ method: 'owner' as const, amount: split.owner }] : []),
      ...(split.credit > 0 ? [{ method: 'credit' as const, amount: split.credit }] : []),
    ];
    const r = await postPurchase(context, {
      supplierId,
      warehouseId: basics.warehouse!.id,
      lines: rows.map((x) => ({
        productId: x.product.id,
        productUnitId: x.unit?.id ?? null,
        unitFactorMilli: x.unit?.factor ?? 1000,
        qtyMilli: x.qty!,
        unitCost: x.cost!,
        newSalePrice: isManager ? x.price : null,
      })),
      payments,
    });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.code === 'E_FORBIDDEN' ? strings.forbidden : strings.purchases.failed);
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <SupplierSelect value={supplierId} onChange={setSupplierId} suppliers={basics.suppliers} />
        <ProductPicker onPick={(p) => void add(p)} label={strings.purchases.addItem} />
      </div>
      {rows.length === 0 && <BigAlert tone="warn" word={strings.purchases.empty} sound={false} />}
      {rows.map((r) => (
        <div key={r.key} className={styles.section} data-testid="purchase-line">
          <h2>
            {r.product.name}
            {r.unit ? ` (${r.unit.name})` : ''}
          </h2>
          <NumberField
            label={strings.purchases.qty}
            value={r.qty}
            onChange={(v) => patch(r.key, { qty: v })}
            parse={toMilli}
            format={formatQty}
            required
          />
          <NumberField
            label={strings.purchases.unitCost}
            value={r.cost}
            onChange={(v) => patch(r.key, { cost: v })}
            parse={toPiasters}
            format={formatMoney}
            required
          />
          {isManager && (
            <NumberField
              label={strings.purchases.salePrice}
              value={r.price}
              onChange={(v) => patch(r.key, { price: v })}
              parse={toPiasters}
              format={formatMoney}
            />
          )}
          <ActionButton
            label={strings.actions.remove}
            icon={Trash2}
            variant="ghost"
            onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
          />
        </div>
      ))}
      {totals && (
        <div className={styles.section}>
          <h2 data-testid="purchase-total">{`${strings.purchases.total}: ${formatMoney(total)}`}</h2>
          <NumberField
            label={strings.purchases.paidCash}
            value={cashPaid}
            onChange={setPaid}
            parse={toPiasters}
            format={formatMoney}
          />
          {mayPayOwner && (
            <NumberField
              label={strings.purchases.paidOwner}
              value={ownerPaid}
              onChange={setOwnerPaid}
              parse={toPiasters}
              format={formatMoney}
            />
          )}
          <p data-testid="purchase-credit">{`${strings.purchases.onCredit}: ${formatMoney(split?.credit ?? 0)}`}</p>
        </div>
      )}
      {error && <BigAlert tone="danger" word={error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.purchases.save}
          variant="ok"
          loading={busy}
          disabled={!supplierId || !totals}
          onClick={() => void save()}
          testId="save-purchase"
        />
      </div>
    </div>
  );
}
