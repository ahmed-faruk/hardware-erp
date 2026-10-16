import { useId, useState, type Ref } from 'react';

import { cx } from '../cx';
import { strings } from '../strings.ar';

import styles from './Combobox.module.css';

export interface ComboOption {
  id: string;
  label: string;
}

/**
 * A text field that suggests while you type (autocomplete): arrow keys move, Enter or a tap picks, Escape closes.
 * The text is the user's; `onPick` fires when an option is chosen (or the text equals one exactly).
 */
export function Combobox({
  id,
  value,
  options,
  onText,
  onPick,
  placeholder,
  testId,
  max = 50,
  filter = true,
  minChars = 0,
  onEnterText,
  inputRef,
  className,
}: {
  id: string;
  value: string;
  options: ComboOption[];
  onText: (text: string) => void;
  onPick: (option: ComboOption) => void;
  placeholder?: string;
  testId?: string;
  max?: number;
  /** false: `options` are shown as given (the caller already searched); default: they are narrowed by the text */
  filter?: boolean;
  /** the list opens only once the text has this many characters */
  minChars?: number;
  /** Enter was pressed: return true when the caller handled it (nothing is picked then) */
  onEnterText?: (text: string, hasActiveOption: boolean) => boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const needle = value.trim().toLowerCase();
  const shown = options
    .filter((o) => !filter || !needle || o.label.toLowerCase().includes(needle))
    .slice(0, max);
  // a caller that searched for itself shows nothing (rather than "no matches") until it has results
  const listOpen = open && value.trim().length >= minChars && (filter || shown.length > 0);
  const pick = (o: ComboOption): void => {
    onPick(o);
    setOpen(false);
  };
  return (
    <div className={styles.root}>
      <input
        id={id}
        ref={inputRef}
        className={cx('control', className)}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          onText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(0, shown.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && onEnterText?.(value, listOpen && !!shown[active]) === true) {
            e.preventDefault();
          } else if (e.key === 'Enter' && listOpen && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {listOpen && (
        <ul
          className={styles.list}
          role="listbox"
          id={listId}
          data-testid={testId ? `${testId}-list` : undefined}
        >
          {shown.length === 0 ? (
            <li className={styles.empty}>{strings.common.noMatches}</li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cx(styles.option, i === active && styles.active)}
                // a tap must pick before the field loses focus and closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                data-testid={testId ? `${testId}-option-${i}` : undefined}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
