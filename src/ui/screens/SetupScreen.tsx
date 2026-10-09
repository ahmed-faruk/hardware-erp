import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import styles from './entry.module.css';

export interface SetupScreenProps {
  /** resolves with the short word to show when activation failed, or null on success */
  onActivate: (code: string) => Promise<string | null>;
}

export function SetupScreen({ onActivate }: SetupScreenProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void onActivate(code).then((word) => {
            setError(word);
            setBusy(false);
          });
        }}
      >
        <KeyRound size={56} aria-hidden="true" />
        <h1>{strings.setup.title}</h1>
        <FormField label={strings.setup.code} hint={strings.setup.codeHint}>
          {(id, d) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-describedby={d}
              data-testid="activation-code"
            />
          )}
        </FormField>
        {error && <BigAlert tone="danger" word={error} />}
        <ActionButton
          label={busy ? strings.setup.working : strings.setup.activate}
          type="submit"
          variant="ok"
          loading={busy}
          disabled={code.length < 10}
          testId="activate"
        />
      </form>
    </main>
  );
}
