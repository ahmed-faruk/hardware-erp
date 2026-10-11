import { useEffect, useState, useSyncExternalStore } from 'react';

import { useServices } from '@/app/session';
import { categoryKpis, categoryTables, marginBp, stackDaily, type CategoriesData } from '@/domain/categories';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';
import { callRpc } from '@/sync/errors';

import { BigAlert } from '../components/BigAlert';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import { CategoryBars, DailyStack } from './CategoryCharts';
import { cairoDay, monthStart } from './dates';
import { PeriodBar } from './PeriodBar';
import { ReportActions, ReportTableView } from './ReportParts';
import styles from './screens.module.css';

const labels = strings.reports as unknown as Record<string, string>;

/** Sales grouped by category: KPIs, a bar chart, a stacked daily chart and the table, for any period. */
export function CategoryReport() {
  const { client, runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [from, setFrom] = useState(() => monthStart(cairoDay()));
  const [to, setTo] = useState(() => cairoDay());
  const [state, setState] = useState<{
    key: string;
    data: CategoriesData | null;
    error: 'offline' | 'failed' | null;
  } | null>(null);
  const key = `${from}|${to}`;

  useEffect(() => {
    let live = true;
    void callRpc<CategoriesData>(client, 'report_categories', { p_from: from, p_to: to }).then((r) => {
      if (!live) return;
      if (!r.ok) return setState({ key, data: null, error: r.network ? 'offline' : 'failed' });
      setState({ key, data: r.data, error: null });
    });
    return () => {
      live = false;
    };
  }, [client, from, to, key]);

  const data = state?.key === key ? state.data : null;
  const error = state?.key === key ? state.error : null;
  const kpis = data ? categoryKpis(data.categories) : null;
  const tables = data ? categoryTables(data, { ...labels, title: strings.reports.tabs.categories }) : null;
  const upTo = sync.lastSyncAt
    ? `${strings.reports.upTo}: ${cairoTime(new Date(sync.lastSyncAt).toISOString())}`
    : strings.reports.notSynced;

  return (
    <div data-testid="category-report">
      <PeriodBar
        from={from}
        to={to}
        onChange={(a, b) => {
          setFrom(a);
          setTo(b);
        }}
      />
      {error === 'offline' && <BigAlert tone="warn" word={strings.reports.needsNet} sound={false} />}
      {error === 'failed' && <BigAlert tone="danger" word={strings.reports.failed} sound={false} />}
      {!data && !error && <Skeleton />}
      {data && kpis && tables && (
        <>
          <div className={styles.kpis}>
            <Kpi
              label={strings.reports.catKpiTop}
              value={kpis.topSales?.name || strings.reports.noCategory}
              sub={kpis.topSales ? formatMoney(kpis.topSales.revenue) : '—'}
              id="kpi-top"
            />
            <Kpi
              label={strings.reports.catKpiMargin}
              value={kpis.topMargin?.name || strings.reports.noCategory}
              sub={
                kpis.topMargin
                  ? `${Math.round(marginBp(kpis.topMargin.profit, kpis.topMargin.revenue) / 100)}%`
                  : '—'
              }
              id="kpi-margin"
            />
            <Kpi label={strings.reports.catKpiActive} value={String(kpis.active)} id="kpi-active" />
            <Kpi
              label={strings.reports.catKpiStock}
              value={kpis.biggestStock?.name || strings.reports.noCategory}
              sub={kpis.biggestStock ? formatMoney(kpis.biggestStock.stock_value) : '—'}
              id="kpi-stock"
            />
          </div>
          <div className={styles.section}>
            <h2>{strings.reports.catChartBars}</h2>
            <CategoryBars rows={data.categories} />
          </div>
          <div className={styles.section}>
            <h2>{strings.reports.catChartDays}</h2>
            <DailyStack data={stackDaily(data.days, data.categories, 6, strings.reports.otherCats)} />
          </div>
          <ReportActions
            tables={tables}
            title={strings.reports.tabs.categories}
            subtitle={`${strings.reports.from} ${from} ${strings.reports.to} ${to}`}
            upTo={upTo}
            filename={`categories-${from}-${to}`}
          />
          <ReportTableView tables={tables} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, id }: { label: string; value: string; sub?: string; id: string }) {
  return (
    <div className={styles.kpiCard} data-testid={id}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}
