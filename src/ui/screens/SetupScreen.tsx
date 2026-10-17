import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import styles from './entry.module.css';

export interface SetupScreenProps {
  /** resolves with the short word to show when the login failed, or null on success */
  onLogin: (username: string, password: string) => Promise<string | null>;
}

/** First run on a browser: a username and a password. No codes. */
export function SetupScreen({ onLogin }: SetupScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        data-testid="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void onLogin(username, password).then((word) => {
            setError(word);
            setBusy(false);
          });
        }}
      >
        <KeyRound size={56} aria-hidden="true" />
        <h1>{strings.setup.title}</h1>
        <FormField label={strings.login.username}>
          {(id) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="login-username"
            />
          )}
        </FormField>
        <FormField label={strings.login.password}>
          {(id) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          )}
        </FormField>
        {error && <BigAlert tone="danger" word={error} />}
        <ActionButton
          label={busy ? strings.setup.working : strings.login.enter}
          type="submit"
          variant="ok"
          loading={busy}
          disabled={!username.trim() || !password}
          testId="login-submit"
        />
      </form>
    </main>
  );
}
