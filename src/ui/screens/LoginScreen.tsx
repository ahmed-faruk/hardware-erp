import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { useServices, useSession, type CurrentWorker } from '@/app/session';

import { BigAlert } from '../components/BigAlert';
import { PinPad } from '../components/PinPad';
import { Skeleton } from '../components/Skeleton';
import { WorkerSwitch } from '../components/WorkerSwitch';
import { strings } from '../strings.ar';

import styles from './entry.module.css';

/** Pick a worker, type the PIN. No usernames, no passwords; checked on the device so it works offline. */
export function LoginScreen() {
  const { db } = useServices();
  const { login } = useSession();
  const workers = useLiveQuery(
    async () =>
      (await db.workers.toArray())
        .filter((w) => w.active && !w.deletedAt && w.pinHash)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [db],
  );
  const [selected, setSelected] = useState<CurrentWorker | null>(null);
  const [locked, setLocked] = useState(false);
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>{strings.login.title}</h1>
        {!workers ? (
          <Skeleton rows={2} />
        ) : workers.length === 0 ? (
          <BigAlert tone="warn" word={strings.login.noWorkers} />
        ) : (
          <WorkerSwitch
            workers={workers}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelected(workers.find((w) => w.id === id) ?? null);
              setLocked(false);
            }}
          />
        )}
        {selected && (
          <PinPad
            onSubmit={async (pin) => {
              const result = await login(selected, pin);
              setLocked(result === 'locked');
              return result === 'ok';
            }}
          />
        )}
        {locked && <BigAlert tone="danger" word={strings.login.locked} />}
      </div>
    </main>
  );
}
