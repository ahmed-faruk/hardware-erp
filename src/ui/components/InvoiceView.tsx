import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';

import { useServices } from '@/app/session';
import { loadInvoiceView, type InvoiceKind } from '@/db/invoice-view';
import { loadDeviceSettings } from '@/db/settings';
import { formatMoney, formatQty } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from './ActionButton';
import { type Column, DataTable } from './DataTable';
import { Dialog } from './Dialog';
import { Skeleton } from './Skeleton';
import { strings } from '../strings.ar';

import styles from './InvoiceView.module.css';

const t = strings.invoiceView;
const methodName = (k: string): string => (strings.receipt.pay as Record<string, string>)[k] ?? k;

interface Props {
  kind: InvoiceKind;
  /** the invoice to show; null = closed */
  invoiceId: string | null;
  onClose: () => void;
}

/** The data of a sales or purchase invoice on the screen, with the same print as the list's print button. */
export function InvoiceViewDialog({ kind, invoiceId, onClose }: Props) {
  return (
    <Dialog
      title={kind === 'sale' ? t.saleTitle : t.purchaseTitle}
      open={invoiceId !== null}
      onClose={onClose}
    >
      {invoiceId && <Body kind={kind} invoiceId={invoiceId} />}
    </Dialog>
  );
}

function Body({ kind, invoiceId }: { kind: InvoiceKind; invoiceId: string }) {
  const { db } = useServices();
  const view = useLiveQuery(() => loadInvoiceView(db, kind, invoiceId), [db, kind, invoiceId]);
  if (view === undefined) return <Skeleton />;
  if (view === null) return <p>{t.notFound}</p>;

  const print = async (): Promise<void> => {
    const [render, { printHtml, cairoFontFaces }] = await Promise.all([
      import('../print/render'),
      import('../print/printHtml'),
    ]);
    if (kind === 'purchase') {
      const { loadPurchaseDocument } = await import('@/db/purchase-document');
      const doc = await loadPurchaseDocument(db, invoiceId);
      if (doc) await printHtml(render.renderPurchaseHtml(doc, cairoFontFaces()));
      return;
    }
    const { loadReceipt } = await import('@/db/commands/receipts');
    const [receipt, device] = await Promise.all([loadReceipt(db, invoiceId, true), loadDeviceSettings(db)]);
    if (receipt.ok) await printHtml(render.renderReceiptHtml(receipt.value, device.paper, cairoFontFaces()));
  };

  const rows = view.lines.map((l, i) => ({ ...l, i }));
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: 'name', header: t.product, cell: (l) => l.name },
    { key: 'qty', header: t.qty, numeric: true, cell: (l) => formatQty(l.qtyMilli) },
    { key: 'price', header: t.price, numeric: true, cell: (l) => formatMoney(l.unitPrice) },
    {
      key: 'discount',
      header: t.discount,
      numeric: true,
      cell: (l) => (l.discount ? formatMoney(l.discount) : '—'),
    },
    { key: 'total', header: t.lineTotal, numeric: true, cell: (l) => formatMoney(l.total) },
    ...(view.kind === 'sale'
      ? [
          {
            key: 'returned',
            header: t.returned,
            numeric: true,
            cell: (l: Row) => (l.returnedMilli ? formatQty(l.returnedMilli) : '—'),
          },
        ]
      : []),
  ];
  const owner = view.payments.filter((p) => p.method === 'owner').reduce((a, p) => a + p.amount, 0);

  return (
    <div className={styles.view} data-testid="invoice-view">
      <header className={styles.head}>
        <strong dir="ltr" data-testid="iv-number">
          {view.number}
        </strong>
        <span dir="ltr">{cairoTime(view.issuedAt)}</span>
        {view.status === 'voided' && (
          <span className={styles.voided} data-testid="iv-status">
            {t.voided}
          </span>
        )}
      </header>
      <dl className={styles.meta}>
        {view.party && (
          <div>
            <dt>{view.kind === 'sale' ? t.customer : t.supplier}</dt>
            <dd>{view.party}</dd>
          </div>
        )}
        {view.worker && (
          <div>
            <dt>{t.worker}</dt>
            <dd>{view.worker}</dd>
          </div>
        )}
      </dl>
      <DataTable label={t.lines} rows={rows} columns={columns} rowKey={(l) => String(l.i)} />
      <dl className={styles.totals}>
        {view.discount > 0 && (
          <div>
            <dt>{t.invoiceDiscount}</dt>
            <dd data-testid="iv-discount">{formatMoney(view.discount)}</dd>
          </div>
        )}
        <div className={styles.grand}>
          <dt>{t.total}</dt>
          <dd data-testid="iv-total">{formatMoney(view.total)}</dd>
        </div>
      </dl>
      <h3>{t.payments}</h3>
      <ul className={styles.list} data-testid="iv-payments">
        {view.payments.map((p, i) => (
          <li key={i}>
            <span>
              {methodName(p.method)}
              {p.reference ? ` (${p.reference})` : ''}
            </span>
            <strong>{formatMoney(p.amount)}</strong>
          </li>
        ))}
      </ul>
      {owner > 0 && (
        <p data-testid="iv-owner">
          {t.ownerPaid}: {formatMoney(owner)}
        </p>
      )}
      {view.returns.length > 0 && (
        <>
          <h3>{t.returns}</h3>
          <ul className={styles.list} data-testid="iv-returns">
            {view.returns.map((r) => (
              <li key={r.number}>
                <span dir="ltr">{r.number}</span>
                <strong>{formatMoney(r.total)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <ActionButton
        big
        label={t.print}
        icon={Printer}
        variant="soft"
        onClick={() => void print()}
        testId="iv-print"
      />
    </div>
  );
}
