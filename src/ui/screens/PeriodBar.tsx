import { ActionButton } from '../components/ActionButton';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import { cairoDay, monthStart } from './dates';
import styles from './screens.module.css';

/** Period presets (today, yesterday, this month, last month) and two date fields for every report that takes a period. */
export function PeriodBar({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const today = cairoDay();
  return (
    <div className={styles.toolbar}>
      <div className={styles.fixed}>
        <ActionButton
          label={strings.reports.today}
          variant="soft"
          onClick={() => onChange(today, today)}
          testId="period-today"
        />
      </div>
      <div className={styles.fixed}>
        <ActionButton
          label={strings.reports.yesterday}
          variant="soft"
          onClick={() => onChange(cairoDay(-1), cairoDay(-1))}
          testId="period-yesterday"
        />
      </div>
      <div className={styles.fixed}>
        <ActionButton
          label={strings.reports.thisMonth}
          variant="soft"
          onClick={() => onChange(monthStart(today), today)}
          testId="period-month"
        />
      </div>
      <div className={styles.fixed}>
        <ActionButton
          label={strings.reports.lastMonth}
          variant="soft"
          onClick={() => {
            const last = cairoDay(-1, new Date(`${monthStart(today)}T12:00:00Z`));
            onChange(monthStart(last), last);
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
            onChange={(e) => e.target.value && onChange(e.target.value, to)}
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
            onChange={(e) => e.target.value && onChange(from, e.target.value)}
            data-testid="report-to"
          />
        )}
      </FormField>
    </div>
  );
}
