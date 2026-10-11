import { useEffect, useState, useSyncExternalStore } from 'react';

import { useServices } from '@/app/session';
import { cairoTime } from '@/domain/receipt';
import { historyTable, type HistoryRow } from '@/domain/reports';
import { callRpc } from '@/sync/errors';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { cairoDay } from './dates';
import { ReportActions, ReportTableView } from './ReportParts';
import styles from './screens.module.css';

interface Page {
  product: { id: string; name: string };
  count: number;
  rows: HistoryRow[];
}

const labels = strings.reports as unknown as Record<string, string>;
const docName = (k: string): string => (strings.reports.docTypes as Record<string, string>)[k] ?? k;

/** Every movement of one product between two dates with the balance after each (server side: it includes the old system's history). */
export function ProductHistory({ productId }: { productId: string }) {
  const { client, runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [today] = useState(() => cairoDay());
  const [from, setFrom] = useState(() => cairoDay(-90));
  const [to, setTo] = useState(() => cairoDay());
  const [data, setData] = useState<{
    key: string;
    page: Page | null;
    error: 'offline' | 'failed' | null;
  } | null>(null);
  const [more_, setMore] = useState<{ key: string; rows: HistoryRow[] }>({ key: '', rows: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${productId}|${from}|${to}`;

  useEffect(() => {
    let live = true;
    void callRpc<Page>(client, 'report_product_history', {
      p_product: productId,
      p_from: from,
      p_to: to,
      p_offset: 0,
    }).then((r) => {
      if (!live) return;
      if (!r.ok) return setData({ key, page: null, error: r.network ? 'offline' : 'failed' });
      setData({ key, page: r.data, error: null });
    });
    return () => {
      live = false;
    };
  }, [client, productId, from, to, key]);

  const page = data?.key === key ? data.page : null;
  const error = data?.key === key ? data.error : null;
  const extra = more_.key === key ? more_.rows : [];
  const rows = page ? [...page.rows, ...extra] : [];
  const more = async (): Promise<void> => {
    setLoadingMore(true);
    const r = await callRpc<Page>(client, 'report_product_history', {
      p_product: productId,
      p_from: from,
      p_to: to,
      p_offset: rows.length,
    });
    setLoadingMore(false);
    if (r.ok) setMore({ key, rows: [...extra, ...r.data.rows] });
  };
  const upTo = sync.lastSyncAt
    ? `${strings.reports.upTo}: ${cairoTime(new Date(sync.lastSyncAt).toISOString())}`
    : strings.reports.notSynced;
  const preset = (a: string): void => {
    setFrom(a);
    setTo(today);
  };
  const tables = page
    ? [historyTable(rows, { ...labels, title: page.product.name }, cairoTime, docName)]
    : null;

  return (
    <div data-testid="product-history">
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.reports.thisMonth}
            variant="soft"
            onClick={() => preset(`${today.slice(0, 8)}01`)}
            testId="history-month"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.reports.last90}
            variant="soft"
            onClick={() => preset(cairoDay(-90))}
            testId="history-90"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.reports.thisYear}
            variant="soft"
            onClick={() => preset(`${today.slice(0, 4)}-01-01`)}
            testId="history-year"
          />
        </div>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.reports.allTime}
            variant="soft"
            onClick={() => preset(cairoDay(-3650))}
            testId="history-all"
          />
        </div>
        <FormField label={strings.reports.from}>
          {(id) => (
            <input
              id={id}
              className="control"
              type="date"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              data-testid="history-from"
            />
          )}
        </FormField>
        <FormField label={strings.reports.to}>
          {(id) => (
            <input
              id={id}
              className="control"
              type="date"
              value={to}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              data-testid="history-to"
            />
          )}
        </FormField>
      </div>
      {error === 'offline' && <BigAlert tone="warn" word={strings.reports.needsNet} sound={false} />}
      {error === 'failed' && <BigAlert tone="danger" word={strings.reports.failed} sound={false} />}
      {!page && !error && <Skeleton />}
      {page && tables && (
        <>
          <p data-testid="history-balance">{`${strings.reports.balance}: ${tables[0]!.rows[0]?.[6] ?? '0'}`}</p>
          <ReportActions
            tables={tables}
            title={`${strings.reports.tabs.productHistory}: ${page.product.name}`}
            subtitle={`${strings.reports.from} ${from} ${strings.reports.to} ${to}`}
            upTo={upTo}
            filename={`history-${from}-${to}`}
          />
          {rows.length === 0 ? <p>{strings.reports.historyNone}</p> : <ReportTableView tables={tables} />}
          {rows.length < page.count && (
            <ActionButton
              label={strings.reports.more}
              variant="ghost"
              loading={loadingMore}
              onClick={() => void more()}
              testId="history-more"
            />
          )}
        </>
      )}
    </div>
  );
}
