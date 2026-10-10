import { useId, type ReactNode } from 'react';

import styles from './FormField.module.css';

export interface FormFieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  /** receives the id to put on the control so the label is connected to it */
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** Label + control + hint + error. The control itself is a native input, select or textarea styled by `controlClass`. */
export function FormField({ label, error, hint, children }: FormFieldProps) {
  const id = useId();
  const noteId = error || hint ? `${id}-note` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children(id, noteId)}
      {(error || hint) && (
        <p id={noteId} className={error ? styles.error : styles.hint} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export { styles as formStyles };
