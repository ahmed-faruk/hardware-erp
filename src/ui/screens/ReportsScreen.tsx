import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { useServices, useSession } from '@/app/session';
import { loadStockRows } from '@/db/stock-report';
import { cairoTime } from '@/domain/receipt';
import {
  devicesTable,
  exceptionsTables,
  expensesTables,
  payrollTables,
  profitTable,
  purchasesTables,
  salesTables,
  stockTable,
  type ReportTable,
} from '@/domain/reports';
import type { Action } from '@/domain/permissions';
import { callRpc } from '@/sync/errors';

import { BigAlert } from '../components/BigAlert';
import { ProductPicker } from '../components/ProductPicker';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { cairoDay, monthStart } from './dates';
import { CategoryReport } from './CategoryReport';
import { PeriodBar } from './PeriodBar';
import { ReportActions, ReportTableView } from './ReportParts';
import { ProductHistory } from './ProductHistory';
import { SmartReport } from './SmartReport';

type Tab =
  | 'smart'
  | 'sales'
  | 'profit'
  | 'purchases'
  | 'expenses'
  | 'categories'
  | 'payroll'
  | 'productHistory'
  | 'exceptions'
  | 'devices'
  | 'stock';
const TABS: Tab[] = [
  'smart',
  'sales',
  'profit',
  'purchases',
  'expenses',
  'categories',
  'payroll',
  'productHistory',
  'exceptions',
  'devices',
  'stock',
];

interface Loaded {
  key: string;
  tables: ReportTable[] | null;
  error: 'offline' | 'failed' | null;
}

const labels = strings.reports as unknown as Record<string, string>;
/** Last server answer per tab and period: switching back to a tab shows it at once, then the fresh answer replaces it. */
const RESULTS = new Map<string, { at: number; value: Loaded }>();
const time = (iso: string): string => cairoTime(iso);
const reasonName = (r: string): string =>
  (strings.voidInvoice.reasons as Record<string, string>)[r] ??
  (strings.stock.reasons as Record<string, string>)[r] ??
  r;
const methodName = (k: string): string => (strings.receipt.pay as Record<string, string>)[k] ?? k;

/** Manager reports: sales, profit, exceptions and devices come from the server (they include the old OpenSourcePOS history); stock comes from this device. */
export function ReportsScreen() {
  const { db, client, runner } = useServices();
  const { can } = useSession();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const tabs = TABS.filter((x) => can(`report.${x}` as Action) !== 'no');
  const [chosen, setTab] = useState<Tab>('smart');
  const tab = tabs.includes(chosen) ? chosen : (tabs[0] ?? 'smart');
  const [from, setFrom] = useState(() => monthStart(cairoDay()));
  const [to, setTo] = useState(() => cairoDay());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // the stock rows are read from this device only when the stock tab is open
  const stockRows = useLiveQuery(
    () => (tab === 'stock' ? loadStockRows(db) : Promise.resolve(undefined)),
    [db, tab],
  );

  const key = `${tab}|${from}|${to}`;
  useEffect(() => {
    if (tab === 'stock' || tab === 'smart' || tab === 'productHistory' || tab === 'categories') return;
    let live = true;
    const name = {
      sales: 'report_sales_summary',
      profit: 'report_profit',
      purchases: 'report_purchases',
      expenses: 'report_expenses',
      payroll: 'report_payroll',
      exceptions: 'report_exceptions',
      devices: 'report_devices',
    }[tab];
    const args = tab === 'devices' ? {} : { p_from: from, p_to: to };
    void callRpc<never>(client, name, args).then((r) => {
      if (!live) return;
      if (!r.ok) return setLoaded({ key, tables: null, error: r.network ? 'offline' : 'failed' });
      const d = r.data as never;
      const t = { ...labels, title: strings.reports.tabs[tab] };
      const tables =
        tab === 'sales'
          ? salesTables(d, t, methodName)
          : tab === 'profit'
            ? [profitTable(d, t)]
            : tab === 'purchases'
              ? purchasesTables(d, t)
              : tab === 'expenses'
                ? expensesTables(d, t, time)
                : tab === 'payroll'
                  ? payrollTables(
                      d,
                      t,
                      time,
                      (k) => (strings.payroll.kinds as Record<string, string>)[k] ?? k,
                    )
                  : tab === 'exceptions'
                    ? exceptionsTables(d, t, time, reasonName)
                    : [devicesTable(d, t, time)];
      const value: Loaded = { key, tables, error: null };
      RESULTS.set(key, { at: Date.now(), value });
      setLoaded(value);
    });
    return () => {
      live = false;
    };
  }, [client, tab, from, to, key]);

  const tables: ReportTable[] | null =
    tab === 'stock'
      ? stockRows
        ? [stockTable(stockRows, { ...labels, title: strings.reports.tabs.stock })]
        : null
      : tab === 'smart'
        ? null
        : loaded?.key === key
          ? loaded.tables
          : // the last answer for this tab and period shows at once while a fresh one loads
            (RESULTS.get(key)?.value.tables ?? null);
  const error =
    tab !== 'stock' &&
    tab !== 'smart' &&
    tab !== 'productHistory' &&
    tab !== 'categories' &&
    loaded?.key === key
      ? loaded.error
      : null;
  const upTo = sync.lastSyncAt
    ? `${strings.reports.upTo}: ${cairoTime(new Date(sync.lastSyncAt).toISOString())}`
    : strings.reports.notSynced;
  const subtitle =
    tab === 'stock' || tab === 'devices' ? '' : `${strings.reports.from} ${from} ${strings.reports.to} ${to}`;

  const preset = (a: string, b: string): void => {
    setFrom(a);
    setTo(b);
  };
  return (
    <section>
      <h1 className={styles.title}>{strings.reports.title}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <SegmentedControl
            label={strings.reports.title}
            options={tabs.map((x) => ({ key: x, label: strings.reports.tabs[x] }))}
            value={tab}
            onChange={setTab}
            testIdPrefix="report-tab-"
          />
        </div>
      </div>
      {tab === 'smart' ? (
        <SmartReport />
      ) : tab === 'productHistory' ? (
        <HistoryTab />
      ) : tab === 'categories' ? (
        <CategoryReport />
      ) : (
        <>
          {tab !== 'stock' && tab !== 'devices' && <PeriodBar from={from} to={to} onChange={preset} />}
          <p data-testid="report-up-to">{upTo}</p>
          {error === 'offline' && <BigAlert tone="warn" word={strings.reports.needsNet} sound={false} />}
          {error === 'failed' && <BigAlert tone="danger" word={strings.reports.failed} sound={false} />}
          {!tables && !error && <Skeleton />}
          {tables && (
            <>
              <ReportActions
                tables={tables}
                title={strings.reports.tabs[tab]}
                subtitle={subtitle}
                upTo={upTo}
                filename={`${tab}-${from}-${to}`}
              />
              <ReportTableView tables={tables} />
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Pick a product, then see its movements. */
function HistoryTab() {
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  return (
    <div>
      <ProductPicker
        onPick={(p) => setProduct({ id: p.id, name: p.name })}
        label={strings.reports.historyPick}
      />
      {product && <h2>{product.name}</h2>}
      {product && <ProductHistory key={product.id} productId={product.id} />}
    </div>
  );
}
