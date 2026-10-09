import type { ReactNode } from 'react';

import { cx } from '../cx';

import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** numbers align to the end and use tabular digits */
  numeric?: boolean;
  /** only shown in the wide table, not on the phone card */
  wideOnly?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** accessible name of the whole table */
  label: string;
}

/** One markup, two layouts: a header + grid rows from 900 px, label/value cards below (docs/DESIGN_SYSTEM.md §8). */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, label }: DataTableProps<T>) {
  const template = { '--cols': columns.length } as React.CSSProperties;
  return (
    <div role="table" aria-label={label} className={styles.table} style={template}>
      <div role="row" className={cx(styles.row, styles.head)}>
        {columns.map((c) => (
          <div key={c.key} role="columnheader" className={cx(styles.cell, c.numeric && styles.numeric)}>
            {c.header}
          </div>
        ))}
      </div>
      {rows.map((row) => {
        const clickable = onRowClick
          ? {
              onClick: () => onRowClick(row),
              onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && onRowClick(row),
              tabIndex: 0,
            }
          : {};
        return (
          <div
            key={rowKey(row)}
            role="row"
            className={cx(styles.row, onRowClick && styles.clickable)}
            {...clickable}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                role="cell"
                data-label={c.header}
                className={cx(styles.cell, c.numeric && styles.numeric, c.wideOnly && styles.wideOnly)}
              >
                {c.cell(row)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
