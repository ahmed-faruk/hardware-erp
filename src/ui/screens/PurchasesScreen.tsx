import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useServices } from '@/app/session';
import { resolveProductIds, searchPurchaseInvoices } from '@/db/invoice-search';
import { EMPTY_FILTER, type InvoiceFilter } from '@/domain/invoice-filter';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { InvoiceViewDialog } from '../components/InvoiceView';
import { useInvoiceDelete } from './useInvoiceDelete';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { navigate } from '../router';
import { InvoiceFilters } from './InvoiceFilters';
import { PurchaseReturnForm } from './PurchaseReturnForm';
import styles from './screens.module.css';

export function PurchasesScreen() {
  const { db } = useServices();
  const [returnOpen, setReturnOpen] = useState(false);
  const [filter, setFilter] = useState<InvoiceFilter>(EMPTY_FILTER);
  const [productText, setProductText] = useState('');
  const [productIds, setProductIds] = useState<string[] | null>(null);
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void resolveProductIds(db, productText).then((ids) => live && setProductIds(ids));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [db, productText]);
  const effective: InvoiceFilter = { ...filter, productIds };
  const filterKey = JSON.stringify(effective);
  // which invoices the filters keep; the list below shows those, newest first
  const kept = useLiveQuery(() => searchPurchaseInvoices(db, effective, 100_000), [db, filterKey]);
  const workers = useLiveQuery(() => db.workers.filter((w) => !w.deletedAt).toArray(), [db]) ?? [];
  const keptIds = new Set((kept?.rows ?? []).map((k) => k.id));
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
      .map((p) => ({
        ...p,
        ownerPaid: owner.get(p.id) ?? 0,
        total: p.total as number,
        supplierId: p.supplierId as string,
        supplierName: suppliers.get(p.supplierId as string) ?? '',
      }));
  }, [db]);
  const [viewId, setViewId] = useState<string | null>(null);
  const del = useInvoiceDelete('purchase', () => setViewId(null));
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
          {del.allowed && p.status === 'posted' && (
            <ActionButton
              label={strings.voidPurchase.button}
              icon={Trash2}
              variant="danger"
              onClick={() => del.request(p.id)}
              testId={`delete-purchase-${p.number}`}
            />
          )}
          {p.status === 'voided' && (
            <strong data-testid={`purchase-voided-${p.number}`}>{strings.voidInvoice.deleted}</strong>
          )}
        </>
      ),
    },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.purchases.title}</h1>
      {del.notice}
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.purchases.newPurchase}
            icon={Plus}
            onClick={() => navigate('purchases', 'new')}
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
      <InvoiceFilters
        kind="purchase"
        value={filter}
        productText={productText}
        onChange={(f) => {
          setFilter(f);
          setLimit(100);
        }}
        onProductText={(x) => {
          setProductText(x);
          setLimit(100);
        }}
        options={{ workers: workers.map((w) => ({ id: w.id, name: w.name })), devices: [], shifts: [] }}
      />
      {!rows || !kept ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Plus} word={strings.purchases.noPurchases} />
      ) : kept.matched === 0 ? (
        <EmptyState icon={Plus} word={strings.invoiceSearch.none} />
      ) : (
        <>
          <p data-testid="result-count">{`${strings.invoiceSearch.count}: ${kept.matched} · ${strings.invoiceSearch.showing}: ${Math.min(limit, kept.matched)}`}</p>
          <DataTable
            label={strings.purchases.title}
            rows={rows.filter((p) => keptIds.has(p.id)).slice(0, limit)}
            columns={columns}
            rowKey={(p) => p.id}
          />
          {kept.matched > limit && (
            <ActionButton
              label={strings.invoiceSearch.more}
              variant="ghost"
              onClick={() => setLimit((n) => n + 100)}
              testId="more-rows"
            />
          )}
        </>
      )}
      <InvoiceViewDialog
        kind="purchase"
        invoiceId={viewId}
        onClose={() => setViewId(null)}
        onDelete={del.allowed ? del.request : undefined}
      />
      {del.dialog}
      <Dialog title={strings.purchases.newReturn} open={returnOpen} onClose={() => setReturnOpen(false)}>
        <PurchaseReturnForm onDone={() => setReturnOpen(false)} />
      </Dialog>
    </section>
  );
}
