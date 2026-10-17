import { useState } from 'react';

import { useSession } from '@/app/session';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import styles from './entry.module.css';

/** Username and password. Checked by the server; a worker who logged in on this device before can log in offline. */
export function LoginScreen() {
  const { login, changePassword } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState<string | null>(null);
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await login(username, password);
    setBusy(false);
    if (r === 'ok') return;
    if (typeof r === 'object') return setMustChange(r.mustChange);
    setError(
      r === 'locked' ? strings.login.locked : r === 'needsNet' ? strings.login.needsNet : strings.login.wrong,
    );
  };

  const change = async (): Promise<void> => {
    if (!mustChange) return;
    if (next.length < 6) return setError(strings.login.short);
    if (next !== next2) return setError(strings.login.mismatch);
    setBusy(true);
    setError(null);
    const ok = await changePassword(mustChange, username, next);
    setBusy(false);
    if (!ok) setError(strings.login.wrong);
  };

  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        data-testid="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          void (mustChange ? change() : submit());
        }}
      >
        <h1>{mustChange ? strings.login.changeTitle : strings.login.title}</h1>
        {mustChange ? (
          <>
            <FormField label={strings.login.newPassword}>
              {(id) => (
                <input
                  id={id}
                  className="control"
                  dir="ltr"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  data-testid="new-password"
                />
              )}
            </FormField>
            <FormField label={strings.login.newPassword2}>
              {(id) => (
                <input
                  id={id}
                  className="control"
                  dir="ltr"
                  type="password"
                  autoComplete="new-password"
                  value={next2}
                  onChange={(e) => setNext2(e.target.value)}
                  data-testid="new-password2"
                />
              )}
            </FormField>
          </>
        ) : (
          <>
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
          </>
        )}
        {error && <BigAlert tone="danger" word={error} />}
        <ActionButton
          label={mustChange ? strings.login.change : strings.login.enter}
          type="submit"
          variant="ok"
          loading={busy}
          disabled={mustChange ? !next || !next2 : !username.trim() || !password}
          testId={mustChange ? 'change-password' : 'login-submit'}
        />
      </form>
    </main>
  );
}
