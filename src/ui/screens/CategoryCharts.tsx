import { niceScale } from '@/domain/chart';
import type { CatRow, Stacked } from '@/domain/categories';
import { formatMoney } from '@/domain/money';

import { strings } from '../strings.ar';

import styles from './CategoryCharts.module.css';

const W = 640;
const colorOf = (token: string | null): string => `var(--${token ?? 'cat-8'})`;
/** Money in whole pounds for axis labels. */
const pounds = (piasters: number): string => String(Math.round(piasters / 100));

/** Horizontal bars: sales of each category in the period, longest first. Drawn right to left like the text. */
export function CategoryBars({ rows }: { rows: CatRow[] }) {
  const shown = rows.filter((r) => r.revenue > 0).slice(0, 12);
  if (shown.length === 0) return <p>{strings.reports.catNoSales}</p>;
  const scale = niceScale(Math.max(...shown.map((r) => r.revenue)));
  const rowH = 34;
  const labelW = 150;
  const valueW = 96;
  const area = W - labelW - valueW;
  const H = shown.length * rowH + 8;
  return (
    <div className={styles.scroll}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={strings.reports.catChartBars}
        data-testid="chart-bars"
      >
        {scale.ticks.slice(1).map((t) => {
          const x = W - labelW - (t / scale.top) * area;
          return <line key={t} x1={x} x2={x} y1={0} y2={H - 8} className={styles.grid} />;
        })}
        {shown.map((r, i) => {
          const y = 4 + i * rowH;
          const len = Math.max(2, (r.revenue / scale.top) * area);
          return (
            <g key={r.id ?? 'none'}>
              <text x={W - 6} y={y + 21} textAnchor="end" className={styles.label}>
                {(r.name || strings.reports.noCategory).slice(0, 18)}
              </text>
              <rect
                x={W - labelW - len}
                y={y + 5}
                width={len}
                height={rowH - 12}
                rx={4}
                style={{ fill: colorOf(r.color) }}
                data-testid={`bar-${r.id ?? 'none'}`}
              />
              <text x={W - labelW - len - 6} y={y + 21} textAnchor="end" className={styles.value}>
                {formatMoney(r.revenue)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Stacked daily columns: each day split by category (the top ones, the rest folded into "other"). Time runs right to left. */
export function DailyStack({ data }: { data: Stacked }) {
  if (data.days.length === 0) return <p>{strings.reports.catNoSales}</p>;
  const scale = niceScale(Math.max(...data.days.map((d) => d.total)));
  const H = 240;
  const top = 12;
  const bottom = 34;
  const axisW = 54;
  const plotW = W - axisW;
  const plotH = H - top - bottom;
  const slot = plotW / data.days.length;
  const barW = Math.min(46, slot * 0.7);
  const every = Math.ceil(data.days.length / 10);
  return (
    <div>
      <div className={styles.scroll}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={strings.reports.catChartDays}
          data-testid="chart-days"
        >
          {scale.ticks.map((t) => {
            const y = top + plotH - (t / scale.top) * plotH;
            return (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y} y2={y} className={styles.grid} />
                <text x={W - 4} y={y + 4} textAnchor="end" className={styles.axis}>
                  {pounds(t)}
                </text>
              </g>
            );
          })}
          {data.days.map((d, di) => {
            const cx = plotW - slot * di - slot / 2;
            let acc = 0;
            return (
              <g key={d.day}>
                {d.values.map((v, ki) => {
                  if (v <= 0) return null;
                  const h = (v / scale.top) * plotH;
                  const y = top + plotH - ((acc + v) / scale.top) * plotH;
                  acc += v;
                  const key = data.keys[ki]!;
                  return (
                    <rect
                      key={ki}
                      x={cx - barW / 2}
                      y={y}
                      width={barW}
                      height={Math.max(1, h)}
                      style={{ fill: key.id === 'other' ? 'var(--text-muted)' : colorOf(key.color) }}
                    />
                  );
                })}
                {di % every === 0 && (
                  <text x={cx} y={H - 12} textAnchor="middle" className={styles.axis}>
                    {d.day.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className={styles.legend}>
        {data.keys.map((k) => (
          <li key={String(k.id)}>
            <i style={{ background: k.id === 'other' ? 'var(--text-muted)' : colorOf(k.color) }} />
            {k.name || strings.reports.noCategory}
          </li>
        ))}
      </ul>
    </div>
  );
}
