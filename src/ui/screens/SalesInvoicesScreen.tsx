import { useLiveQuery } from 'dexie-react-hooks';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useServices } from '@/app/session';
import { resolveProductIds, searchSalesInvoices } from '@/db/invoice-search';
import { EMPTY_FILTER, type InvoiceFilter } from '@/domain/invoice-filter';
import { formatMoney, formatQty } from '@/domain/money';
import { callRpc } from '@/sync/errors';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { InvoiceViewDialog } from '../components/InvoiceView';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { InvoiceFilters, statusChipClass } from './InvoiceFilters';
import styles from './screens.module.css';

const t = strings.invoiceSearch;
const PAGE = 100;
const methodName = (k: string): string => (strings.receipt.pay as Record<string, string>)[k] ?? k;

interface LegacyRow {
  id: number;
  number: string;
  kind: number;
  day: string;
  customer: string;
  total: number;
  cash: number;
  card: number;
  credit: number;
  other: number;
}
interface LegacyDetail extends LegacyRow {
  lines: { product: string; qty: number; net: number }[];
}

/** The sales invoices of this device, searchable offline; and the old OpenSourcePOS history from the server, to read. */
export function SalesInvoicesScreen() {
  const { db, client } = useServices();
  const [mode, setMode] = useState<'new' | 'old'>('new');
  const [filter, setFilter] = useState<InvoiceFilter>(EMPTY_FILTER);
  const [productText, setProductText] = useState('');
  const [productIds, setProductIds] = useState<string[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [viewId, setViewId] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<{ rows: LegacyRow[]; matched: number } | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<LegacyDetail | null>(null);

  // the product box means the products matching a name or a barcode
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
  const key = JSON.stringify(effective);
  const result = useLiveQuery(
    () => (mode === 'new' ? searchSalesInvoices(db, effective, limit) : Promise.resolve(null)),
    [db, mode, key, limit],
  );
  const workers = useLiveQuery(() => db.workers.filter((w) => !w.deletedAt).toArray(), [db]) ?? [];
  const devices = useLiveQuery(() => db.devices.toArray(), [db]) ?? [];
  const shifts =
    useLiveQuery(
      async () =>
        (await db.shifts.toArray()).sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 60),
      [db],
    ) ?? [];
  const options = {
    workers: workers.map((w) => ({ id: w.id, name: w.name })),
    devices: devices.map((d) => ({ id: d.id, name: d.name })),
    shifts: shifts.map((s) => ({ id: s.id, name: s.number })),
  };

  // the old history: asked of the server, a moment after the last change
  useEffect(() => {
    if (mode !== 'old') return;
    let live = true;
    const timer = setTimeout(() => {
      setLegacyBusy(true);
      void callRpc<{ matched: number; rows: LegacyRow[] }>(client, 'search_legacy_sales', {
        p_from: filter.from || null,
        p_to: filter.to || null,
        p_number: filter.number || null,
        p_customer: filter.party || null,
        p_min: filter.minAmount,
        p_max: filter.maxAmount,
        p_method: filter.method || null,
        p_product: productText.trim() || null,
        p_kind: null,
        p_offset: offset,
      }).then((r) => {
        if (!live) return;
        setLegacyBusy(false);
        if (!r.ok) {
          setLegacy(null);
          return setLegacyError(r.network ? t.needsNet : strings.reports.failed);
        }
        setLegacyError(null);
        setLegacy(r.data);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, mode, filter, productText, offset]);

  const openDetail = async (id: number): Promise<void> => {
    const r = await callRpc<LegacyDetail>(client, 'legacy_sale_detail', { p_id: id });
    if (r.ok) setDetail(r.data);
    else setLegacyError(r.network ? t.needsNet : strings.reports.failed);
  };

  const newColumns: Column<NonNullable<typeof result>['rows'][number]>[] = [
    { key: 'number', header: t.number, cell: (r) => <span dir="ltr">{r.number}</span> },
    { key: 'day', header: t.date, cell: (r) => <span dir="ltr">{r.day}</span> },
    { key: 'party', header: t.customer, cell: (r) => r.partyName || '—' },
    {
      key: 'pay',
      header: t.pay,
      wideOnly: true,
      cell: (r) => [...new Set(r.methods)].map(methodName).join(strings.cash.listSeparator) || '—',
    },
    { key: 'total', header: t.total, numeric: true, cell: (r) => formatMoney(r.total) },
    {
      key: 'status',
      header: t.status,
      cell: (r) => (
        <span className={statusChipClass(r.status, r.hasReturn)} data-testid={`status-${r.number}`}>
          {r.status === 'voided' ? t.statusVoided : r.hasReturn ? t.statusReturned : t.statusPosted}
        </span>
      ),
    },
    {
      key: 'view',
      header: '',
      cell: (r) => (
        <ActionButton
          label={strings.invoiceView.view}
          icon={Eye}
          variant="ghost"
          onClick={() => setViewId(r.id)}
          testId={`view-${r.number}`}
        />
      ),
    },
  ];
  const oldColumns: Column<LegacyRow>[] = [
    { key: 'number', header: t.number, cell: (r) => <span dir="ltr">{r.number}</span> },
    { key: 'day', header: t.date, cell: (r) => <span dir="ltr">{r.day}</span> },
    { key: 'party', header: t.customer, cell: (r) => r.customer || '—' },
    {
      key: 'pay',
      header: t.pay,
      wideOnly: true,
      cell: (r) =>
        (
          [
            ['cash', r.cash],
            ['card', r.card],
            ['credit', r.credit],
            ['other', r.other],
          ] as const
        )
          .filter(([, v]) => v > 0)
          .map(([k]) => methodName(k))
          .join(strings.cash.listSeparator) || '—',
    },
    { key: 'total', header: t.total, numeric: true, cell: (r) => formatMoney(r.total) },
    {
      key: 'kind',
      header: t.status,
      cell: (r) =>
        r.kind === 1 ? <span className={statusChipClass('posted', true)}>{t.returnKind}</span> : '—',
    },
    {
      key: 'view',
      header: '',
      cell: (r) => (
        <ActionButton
          label={strings.invoiceView.view}
          icon={Eye}
          variant="ghost"
          onClick={() => void openDetail(r.id)}
          testId={`view-${r.number}`}
        />
      ),
    },
  ];

  return (
    <section>
      <h1 className={styles.title}>{t.title}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <SegmentedControl
            label={t.title}
            options={[
              { key: 'new', label: t.modeNew },
              { key: 'old', label: t.modeOld },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setOffset(0);
              setLimit(PAGE);
            }}
            testIdPrefix="sales-mode-"
          />
        </div>
      </div>
      {mode === 'old' && <p data-testid="old-note">{t.oldNote}</p>}
      <InvoiceFilters
        kind="sale"
        value={filter}
        productText={productText}
        onChange={(f) => {
          setFilter(f);
          setLimit(PAGE);
          setOffset(0);
        }}
        onProductText={(x) => {
          setProductText(x);
          setLimit(PAGE);
          setOffset(0);
        }}
        options={options}
        legacy={mode === 'old'}
      />
      {mode === 'new' ? (
        !result ? (
          <Skeleton />
        ) : result.rows.length === 0 ? (
          <EmptyState icon={Eye} word={t.none} />
        ) : (
          <>
            <p data-testid="result-count">{`${t.count}: ${result.matched} · ${t.showing}: ${result.rows.length}`}</p>
            <DataTable label={t.title} rows={result.rows} columns={newColumns} rowKey={(r) => r.id} />
            {result.matched > result.rows.length && (
              <ActionButton
                label={t.more}
                variant="ghost"
                onClick={() => setLimit((n) => n + PAGE)}
                testId="more-rows"
              />
            )}
          </>
        )
      ) : (
        <>
          {legacyError && <BigAlert tone="warn" word={legacyError} sound={false} />}
          {legacyBusy && <p>{t.loading}</p>}
          {legacy && legacy.rows.length === 0 && !legacyBusy && <EmptyState icon={Eye} word={t.none} />}
          {legacy && legacy.rows.length > 0 && (
            <>
              <p data-testid="result-count">{`${t.count}: ${legacy.matched} · ${t.showing}: ${offset + 1}–${offset + legacy.rows.length}`}</p>
              <DataTable
                label={t.title}
                rows={legacy.rows}
                columns={oldColumns}
                rowKey={(r) => String(r.id)}
              />
              <div className={styles.toolbar}>
                <ActionButton
                  label={strings.common.back}
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                  testId="old-prev"
                />
                <ActionButton
                  label={t.more}
                  variant="ghost"
                  disabled={offset + legacy.rows.length >= legacy.matched}
                  onClick={() => setOffset((o) => o + PAGE)}
                  testId="old-next"
                />
              </div>
            </>
          )}
        </>
      )}
      <InvoiceViewDialog kind="sale" invoiceId={viewId} onClose={() => setViewId(null)} />
      <Dialog
        title={detail ? detail.number : t.oldDetail}
        open={detail !== null}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div data-testid="old-detail">
            <p>
              <span dir="ltr">{detail.day}</span> {detail.customer && `— ${detail.customer}`}
            </p>
            <DataTable
              label={t.oldDetail}
              rows={detail.lines.map((l, i) => ({ ...l, i }))}
              columns={[
                { key: 'p', header: strings.invoiceView.product, cell: (l) => l.product || '—' },
                { key: 'q', header: strings.invoiceView.qty, numeric: true, cell: (l) => formatQty(l.qty) },
                {
                  key: 'n',
                  header: strings.invoiceView.lineTotal,
                  numeric: true,
                  cell: (l) => formatMoney(l.net),
                },
              ]}
              rowKey={(l) => String(l.i)}
            />
            <strong data-testid="old-detail-total">{`${strings.invoiceView.total}: ${formatMoney(detail.total)}`}</strong>
          </div>
        )}
      </Dialog>
    </section>
  );
}
