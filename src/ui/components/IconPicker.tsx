import { useState } from 'react';

import { CATALOG, searchIcons } from '../icons/catalog';
import { strings } from '../strings.ar';
import { cx } from '../cx';

import styles from './IconPicker.module.css';

export interface IconPickerProps {
  value: string | null;
  onChange: (key: string | null) => void;
}

/** Grid of bundled icons with Arabic names and a search box. Works offline. */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [query, setQuery] = useState('');
  const shown = query ? searchIcons(query) : CATALOG;
  return (
    <div className={styles.picker}>
      <input
        className="control"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={strings.icons.search}
        aria-label={strings.icons.search}
      />
      <ul className={styles.grid}>
        <li>
          <button
            type="button"
            className={cx(styles.cell, value === null && styles.selected)}
            onClick={() => onChange(null)}
            aria-pressed={value === null}
          >
            <span className={styles.none} aria-hidden="true">
              ∅
            </span>
            <span className={styles.name}>{strings.icons.none}</span>
          </button>
        </li>
        {shown.map(({ key, name, Icon }) => (
          <li key={key}>
            <button
              type="button"
              className={cx(styles.cell, value === key && styles.selected)}
              onClick={() => onChange(key)}
              aria-pressed={value === key}
              title={name}
            >
              <Icon size={28} aria-hidden="true" />
              <span className={styles.name}>{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
