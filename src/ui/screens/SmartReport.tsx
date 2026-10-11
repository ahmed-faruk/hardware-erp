import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { useServices } from '@/app/session';
import { loadInsights } from '@/db/insights';
import {
  customerCadence,
  deadStock,
  HEAT_FIRST_HOUR,
  hourHeat,
  reorderPlan,
  topSellers,
  type Urgency,
} from '@/domain/insights';
import { formatMoney, formatQty } from '@/domain/money';

import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import screens from './screens.module.css';
import styles from './SmartReport.module.css';

const t = strings.reports.smart;
const screensTable = screens.reportTable;
const num = screens.num;
const COVER = [7, 14, 30] as const;
type Cover = (typeof COVER)[number];

const pillFor: Record<Urgency, { label: string; cls: string }> = {
  now: { label: t.urgNow, cls: styles.now! },
  soon: { label: t.urgSoon, cls: styles.soon! },
  normal: { label: t.urgNormal, cls: styles.normal! },
};

/** The manager's "what should I do" page: what to buy and when, what sells, what sleeps, who is late. All from this device. */
export function SmartReport() {
  const { db } = useServices();
  const [cover, setCover] = useState<Cover>(14);
  const data = useLiveQuery(() => loadInsights(db), [db]);
  if (!data) return <Skeleton rows={6} />;

  const plan = reorderPlan(data.products, cover);
  const buyTotal = plan.reduce((a, r) => a + r.cost, 0);
  const top = topSellers(data.products, 5);
  const dead = deadStock(data.products, data.today, 90);
  const deadValue = dead.reduce((a, r) => a + r.value, 0);
  const cadence = customerCadence(data.events, data.today);
  const heat = hourHeat(data.events);
  const k = data.kpis;
  const kpis: [string, string, boolean?][] = [
    [t.kpiSales, formatMoney(k.todayNet)],
    [t.kpiInvoices, String(k.todayInvoices)],
    [t.kpiBasket, formatMoney(k.avgBasket)],
    [t.kpiStock, formatMoney(k.stockValue)],
    [t.kpiReceivables, formatMoney(k.receivables), k.receivables > 0],
    [t.kpiPayables, formatMoney(k.payables)],
    [t.kpiExpenses, formatMoney(k.monthExpenses)],
  ];

  return (
    <div className={styles.wrap} data-testid="smart-report">
      <div className={styles.kpis}>
        {kpis.map(([label, value, warn], i) => (
          <div
            key={label}
            className={`${styles.kpi} ${warn ? styles.kpiWarn : ''}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className={styles.block} data-testid="smart-buy">
        <h2>
          {t.buyTitle} <small>{t.buyHint}</small>
        </h2>
        <div className={`${styles.card} ${styles.cover}`}>
          <strong>{t.cover}</strong>
          <SegmentedControl
            label={t.cover}
            options={COVER.map((d) => ({ key: String(d), label: `${d} ${t.days}` }))}
            value={String(cover)}
            onChange={(v) => setCover(Number(v) as Cover)}
            testIdPrefix="smart-cover-"
          />
          <span className={styles.grow} />
          <span>
            {t.buyTotal} <strong data-testid="smart-buy-total">{formatMoney(buyTotal)}</strong>
          </span>
        </div>
        {plan.length === 0 ? (
          <p className={styles.card}>{t.buyNone}</p>
        ) : (
          <div className={`${styles.card} ${styles.scroll}`}>
            <table className={screensTable}>
              <thead>
                <tr>
                  <th>{t.product}</th>
                  <th className={num}>{t.stock}</th>
                  <th className={num}>{t.perDay}</th>
                  <th>{t.runsOut}</th>
                  <th className={num}>{t.order}</th>
                  <th className={num}>{t.cost}</th>
                  <th>{t.from}</th>
                  <th>{t.urgency}</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((r) => (
                  <tr key={r.productId} data-testid={`smart-buy-${r.productId}`}>
                    <td>{r.name}</td>
                    <td className={num}>{formatQty(r.stockMilli)}</td>
                    <td className={num}>{formatQty(r.perDayMilli)}</td>
                    <td>{r.daysLeft === 0 ? t.outNow : t.inDays.replace('{n}', String(r.daysLeft))}</td>
                    <td className={num}>
                      <strong>{formatQty(r.suggestMilli)}</strong>
                    </td>
                    <td className={num}>{formatMoney(r.cost)}</td>
                    <td>{r.supplierName || '—'}</td>
                    <td>
                      <span className={`${styles.pill} ${pillFor[r.urgency].cls}`}>
                        {pillFor[r.urgency].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.note}>{t.formula}</p>
      </section>

      <div className={styles.cols}>
        <section className={styles.block}>
          <h2>
            {t.topTitle} <small>{t.topHint}</small>
          </h2>
          <div className={styles.card}>
            {top.map((r, i) => (
              <div key={r.productId} className={styles.item}>
                <span>{r.name}</span>
                <strong>{formatMoney(r.revenue)}</strong>
                <div className={styles.bar}>
                  <i style={{ width: `${r.sharePercent}%`, animationDelay: `${i * 90}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.block} data-testid="smart-categories">
          <h2>
            {t.catTitle} <small>{t.topHint}</small>
          </h2>
          <div className={styles.card}>
            {data.topCategories.length === 0 && <span>{strings.reports.catNoSales}</span>}
            {data.topCategories.map((c, i) => (
              <div key={c.id ?? 'none'} className={styles.item}>
                <span>{c.name || strings.reports.noCategory}</span>
                <strong>{formatMoney(c.revenue)}</strong>
                <div className={styles.bar}>
                  <i
                    style={{
                      width: `${Math.round((c.revenue * 100) / data.topCategories[0]!.revenue)}%`,
                      animationDelay: `${i * 90}ms`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.block} data-testid="smart-dead">
          <h2>
            {t.deadTitle} <small>{t.deadHint}</small>
          </h2>
          <div className={styles.card}>
            {dead.length === 0 && <span>{t.deadNone}</span>}
            {dead.slice(0, 6).map((r) => (
              <div key={r.productId} className={styles.item}>
                <span>
                  {r.name}
                  <br />
                  <small className={styles.note}>
                    {formatQty(r.stockMilli)} ·{' '}
                    {r.daysIdle === null ? t.deadNever : t.idleDays.replace('{n}', String(r.daysIdle))}
                  </small>
                </span>
                <strong>{formatMoney(r.value)}</strong>
              </div>
            ))}
            {dead.length > 0 && (
              <div className={styles.total}>
                <span>{t.deadTotal}</span>
                <span>{formatMoney(deadValue)}</span>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className={styles.block} data-testid="smart-customers">
        <h2>
          {t.custTitle} <small>{t.custHint}</small>
        </h2>
        {cadence.length === 0 ? (
          <p className={styles.card}>{t.custNone}</p>
        ) : (
          <div className={`${styles.card} ${styles.scroll}`}>
            <table className={screensTable}>
              <thead>
                <tr>
                  <th>{t.customer}</th>
                  <th className={num}>{t.spend}</th>
                  <th className={num}>{t.avgOrder}</th>
                  <th className={num}>{t.every}</th>
                  <th className={num}>{t.last}</th>
                  <th>{t.expect}</th>
                </tr>
              </thead>
              <tbody>
                {cadence.slice(0, 8).map((r) => (
                  <tr key={r.customerId}>
                    <td>{data.customerNames.get(r.customerId) ?? '—'}</td>
                    <td className={num}>{formatMoney(r.spend)}</td>
                    <td className={num}>{formatMoney(r.avgOrder)}</td>
                    <td className={num}>{r.everyDays}</td>
                    <td className={num}>{r.daysSinceLast}</td>
                    <td>
                      <span
                        className={`${styles.pill} ${r.status === 'late' ? styles.now : r.status === 'soon' ? styles.soon : styles.ok}`}
                      >
                        {r.status === 'late' ? t.late : r.status === 'soon' ? t.soon : t.ontime}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.block} data-testid="smart-heat">
        <h2>
          {t.heatTitle} <small>{t.heatHint}</small>
        </h2>
        <div className={styles.card}>
          <div className={styles.heat}>
            <span />
            {Array.from({ length: 13 }, (_, i) => (
              <span key={i}>{HEAT_FIRST_HOUR + i}</span>
            ))}
            {heat.cells.map((row, d) => (
              <HeatRow key={d} label={t.weekdays[d]!} row={row} />
            ))}
          </div>
          {heat.busiest && (
            <p className={styles.note}>
              {t.busiest
                .replace('{day}', t.weekdays[heat.busiest.weekday]!)
                .replace('{hour}', String(heat.busiest.hour))}
            </p>
          )}
        </div>
      </section>
      <p className={styles.note}>{t.localNote}</p>
    </div>
  );
}

function HeatRow({ label, row }: { label: string; row: number[] }) {
  return (
    <>
      <span>{label}</span>
      {row.map((v, i) => (
        <i key={i} style={{ opacity: Math.max(0.06, v / 100), animationDelay: `${i * 25}ms` }} />
      ))}
    </>
  );
}
