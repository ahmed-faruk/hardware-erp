import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { loadDeviceSettings } from '@/db/settings';

import { strings } from '../strings.ar';

import { BigAlert } from './BigAlert';

const DAY_MS = 24 * 3600 * 1000;

/** BAK-02: warns about data not uploaded for over a day and (managers) a local backup older than a day. Re-checked every minute. */
export function HealthBanner() {
  const { db } = useServices();
  const { worker } = useSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const state = useLiveQuery(async () => {
    const oldest = (await db.outbox.where('status').equals('pending').toArray())
      .map((o) => o.createdAt)
      .sort()[0];
    return { oldest: oldest ?? null, device: await loadDeviceSettings(db) };
  }, [db, now]);
  if (!state || !worker) return null;
  const unsynced = state.oldest !== null && now - Date.parse(state.oldest) > DAY_MS;
  const last = state.device.lastBackupAt;
  const noBackup = worker.role === 'manager' && (!last || now - Date.parse(last) > DAY_MS);
  return (
    <>
      {unsynced && <BigAlert tone="warn" word={strings.health.unsynced} sound={false} />}
      {noBackup && <BigAlert tone="warn" word={strings.health.noBackup} sound={false} />}
    </>
  );
}
