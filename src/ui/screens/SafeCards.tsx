import { formatMoney } from '@/domain/money';

import { strings } from '../strings.ar';

import styles from './SmartReport.module.css';

export interface SafeCardsData {
  net: number;
  cash_now: { total: number };
  returns_today: {
    returns_count: number;
    returns_total: number;
    voided_count: number;
    voided_total: number;
    today_total: number;
  };
}

/** The three numbers the owner reads first: the net of the period, the cash in the shop now, and today's returns. */
export function SafeCards({ data }: { data: SafeCardsData }) {
  const t = strings.reports.safe;
  const r = data.returns_today;
  return (
    <div className={styles.kpis} data-testid="safe-cards">
      <div className={`${styles.kpi} ${data.net < 0 ? styles.kpiWarn : ''}`}>
        <span>{t.net}</span>
        <strong data-testid="safe-net">{formatMoney(data.net)}</strong>
      </div>
      <div className={styles.kpi} data-testid="safe-cash-now-card">
        <span>{t.cashNow}</span>
        <strong data-testid="safe-cash-now">{formatMoney(data.cash_now.total)}</strong>
      </div>
      <div
        className={`${styles.kpi} ${r.today_total > 0 ? styles.kpiWarn : ''}`}
        data-testid="safe-returns-card"
      >
        <span>{t.returnsToday}</span>
        <strong data-testid="safe-returns-today">{formatMoney(r.today_total)}</strong>
        <small data-testid="safe-returns-count">
          {`${t.returnsLine}: ${r.returns_count} · ${formatMoney(r.returns_total)}`}
        </small>
        <small data-testid="safe-voided-count">
          {`${t.voidedLine}: ${r.voided_count} · ${formatMoney(r.voided_total)}`}
        </small>
      </div>
    </div>
  );
}
