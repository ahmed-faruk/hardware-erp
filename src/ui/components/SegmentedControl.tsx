import { cx } from '../cx';

import styles from './SegmentedControl.module.css';

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
}

export interface SegmentedControlProps<K extends string> {
  label: string;
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** each button gets `data-testid="<prefix><key>"` */
  testIdPrefix?: string;
}

/** One-of-many choice shown as a single grouped control (report tabs, period presets). */
export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: SegmentedControlProps<K>) {
  return (
    <div className={styles.group} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          className={cx(styles.segment, o.key === value && styles.on)}
          onClick={() => onChange(o.key)}
          data-testid={testIdPrefix ? `${testIdPrefix}${o.key}` : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
