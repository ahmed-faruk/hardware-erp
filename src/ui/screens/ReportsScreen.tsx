import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Printer } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { useServices } from '@/app/session';
import { loadStockRows } from '@/db/stock-report';
import { toCsv } from '@/domain/csv';
import { cairoTime } from '@/domain/receipt';
import {
  devicesTable,
  exceptionsTables,
  profitTable,
  salesTables,
  stockTable,
  type ReportTable,
} from '@/domain/reports';
import { callRpc } from '@/sync/errors';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

type Tab = 'sales' | 'profit' | 'exceptions' | 'devices' | 'stock';
const TABS: Tab[] = ['sales', 'profit', 'exceptions', 'devices', 'stock'];

const cairoDay = (offsetDays = 0, base = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(
    new Date(base.getTime() + offsetDays * 86_400_000),
  );
const monthStart = (day: string): string => `${day.slice(0, 8)}01`;

interface Loaded {
  key: string;
  tables: ReportTable[] | null;
  error: 'offline' | 'failed' | null;
}

const labels = strings.reports as unknown as Record<string, string>;
const time = (iso: string): string => cairoTime(iso);
const reasonName = (r: string): string =>
  (strings.voidInvoice.reasons as Record<string, string>)[r] ??
  (strings.stock.reasons as Record<string, string>)[r] ??
  r;
const methodName = (k: string): string => (strings.receipt.pay as Record<string, string>)[k] ?? k;

/** Manager reports: sales, profit, exceptions and devices come from the server (they include the old OpenSourcePOS history); stock comes from this device. */
export function ReportsScreen() {
  const { db, client, runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [tab, setTab] = useState<Tab>('sales');
  const [today] = useState(() => cairoDay());
  const [from, setFrom] = useState(() => monthStart(cairoDay()));
  const [to, setTo] = useState(() => cairoDay());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const stockRows = useLiveQuery(() => loadStockRows(db), [db]);

  const key = `${tab}|${from}|${to}`;
  useEffect(() => {
    if (tab === 'stock') return;
    let live = true;
    const name = {
      sales: 'report_sales_summary',
      profit: 'report_profit',
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
            : tab === 'exceptions'
              ? exceptionsTables(d, t, time, reasonName)
              : [devicesTable(d, t, time)];
      setLoaded({ key, tables, error: null });
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
      : loaded?.key === key
        ? loaded.tables
        : null;
  const error = tab !== 'stock' && loaded?.key === key ? loaded.error : null;
  const upTo = sync.lastSyncAt
    ? `${strings.reports.upTo}: ${cairoTime(new Date(sync.lastSyncAt).toISOString())}`
    : strings.reports.notSynced;
  const subtitle =
    tab === 'stock' || tab === 'devices' ? '' : `${strings.reports.from} ${from} ${strings.reports.to} ${to}`;

  const preset = (a: string, b: string): void => {
    setFrom(a);
    setTo(b);
  };
  const exportCsv = (): void => {
    if (!tables) return;
    const rows: (string | number)[][] = [];
    for (const t of tables) {
      rows.push([t.title], t.headers, ...t.rows);
      if (t.totals) rows.push(t.totals);
      rows.push([]);
    }
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab}-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const print = async (): Promise<void> => {
    if (!tables) return;
    const [render, { printHtml, cairoFontFaces }, company] = await Promise.all([
      import('../print/render'),
      import('../print/printHtml'),
      db.companies.toCollection().first(),
    ]);
    await printHtml(
      render.renderReportHtml(
        { shopName: company?.name ?? '', title: strings.reports.tabs[tab], subtitle, upTo, tables },
        cairoFontFaces(),
      ),
    );
  };

  return (
    <section>
      <h1 className={styles.title}>{strings.reports.title}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <SegmentedControl
            label={strings.reports.title}
            options={TABS.map((x) => ({ key: x, label: strings.reports.tabs[x] }))}
            value={tab}
            onChange={setTab}
            testIdPrefix="report-tab-"
          />
        </div>
      </div>
      {tab !== 'stock' && tab !== 'devices' && (
        <div className={styles.toolbar}>
          <div className={styles.fixed}>
            <ActionButton
              label={strings.reports.today}
              variant="soft"
              onClick={() => preset(today, today)}
              testId="period-today"
            />
          </div>
          <div className={styles.fixed}>
            <ActionButton
              label={strings.reports.yesterday}
              variant="soft"
              onClick={() => preset(cairoDay(-1), cairoDay(-1))}
              testId="period-yesterday"
            />
          </div>
          <div className={styles.fixed}>
            <ActionButton
              label={strings.reports.thisMonth}
              variant="soft"
              onClick={() => preset(monthStart(today), today)}
              testId="period-month"
            />
          </div>
          <div className={styles.fixed}>
            <ActionButton
              label={strings.reports.lastMonth}
              variant="soft"
              onClick={() => {
                const last = cairoDay(-1, new Date(`${monthStart(today)}T12:00:00Z`));
                preset(monthStart(last), last);
              }}
              testId="period-last-month"
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
                data-testid="report-from"
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
                data-testid="report-to"
              />
            )}
          </FormField>
        </div>
      )}
      <p data-testid="report-up-to">{upTo}</p>
      {error === 'offline' && <BigAlert tone="warn" word={strings.reports.needsNet} sound={false} />}
      {error === 'failed' && <BigAlert tone="danger" word={strings.reports.failed} sound={false} />}
      {!tables && !error && <Skeleton />}
      {tables && (
        <>
          <div className={styles.actions}>
            <ActionButton
              label={strings.reports.print}
              icon={Printer}
              variant="ghost"
              onClick={() => void print()}
              testId="report-print"
            />
            <ActionButton
              label={strings.reports.csv}
              icon={Download}
              variant="ghost"
              onClick={exportCsv}
              testId="report-csv"
            />
          </div>
          {tables.map((t, i) => (
            <div key={i} className={styles.section} data-testid={`report-table-${i}`}>
              {i > 0 && <h2>{t.title}</h2>}
              {t.rows.length === 0 && !t.totals ? (
                <p>{strings.reports.none}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.reportTable}>
                    <thead>
                      <tr>
                        {t.headers.map((h, hi) => (
                          <th key={h} className={hi > 0 ? styles.num : undefined}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((c, ci) => (
                            <td
                              key={ci}
                              dir={ci > 0 ? 'ltr' : undefined}
                              className={ci > 0 ? styles.num : undefined}
                            >
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {t.totals && (
                        <tr data-testid={`report-totals-${i}`} className={styles.totalRow}>
                          {t.totals.map((c, ci) => (
                            <td
                              key={ci}
                              dir={ci > 0 ? 'ltr' : undefined}
                              className={ci > 0 ? styles.num : undefined}
                            >
                              {c}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {t.note && <p>{t.note}</p>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
