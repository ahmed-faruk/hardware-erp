import { useState } from 'react';

import type { Result } from '@/domain/result';

import { strings } from '../strings.ar';

import { FormField } from './FormField';

export interface NumberFieldProps {
  label: string;
  /** committed value (piasters, milli-units, integers...); null = empty */
  value: number | null;
  onChange: (value: number | null) => void;
  parse: (text: string) => Result<number>;
  format: (value: number) => string;
  hint?: string;
  required?: boolean;
  suffix?: string;
}

/** Numbers are typed as text and parsed by the domain (never parseFloat). Only a valid value is committed. */
export function NumberField({
  label,
  value,
  onChange,
  parse,
  format,
  hint,
  required,
  suffix,
}: NumberFieldProps) {
  const [text, setText] = useState(value === null ? '' : format(value));
  const [invalid, setInvalid] = useState(false);
  const change = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setInvalid(required === true);
      onChange(null);
      return;
    }
    const parsed = parse(next);
    setInvalid(!parsed.ok);
    if (parsed.ok) onChange(parsed.value);
  };
  return (
    <FormField
      label={suffix ? `${label} (${suffix})` : label}
      error={invalid ? strings.errors.invalid : null}
      hint={hint}
    >
      {(id, describedBy) => (
        <input
          id={id}
          className="control"
          inputMode="decimal"
          dir="ltr"
          value={text}
          onChange={(e) => change(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      )}
    </FormField>
  );
}
