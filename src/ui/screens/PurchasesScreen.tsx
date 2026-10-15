import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Plus, Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { useServices } from '@/app/session';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { InvoiceViewDialog } from '../components/InvoiceView';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { navigate } from '../router';
import { PurchaseReturnForm } from './PurchaseReturnForm';
import styles from './screens.module.css';

export function PurchasesScreen() {
  const { db } = useServices();
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
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Plus} word={strings.purchases.noPurchases} />
      ) : (
        <DataTable label={strings.purchases.title} rows={rows} columns={columns} rowKey={(p) => p.id} />
      )}
      <InvoiceViewDialog kind="purchase" invoiceId={viewId} onClose={() => setViewId(null)} />
      <Dialog title={strings.purchases.newReturn} open={returnOpen} onClose={() => setReturnOpen(false)}>
        <PurchaseReturnForm onDone={() => setReturnOpen(false)} />
      </Dialog>
    </section>
  );
}
