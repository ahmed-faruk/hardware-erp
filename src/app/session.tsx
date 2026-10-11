import type { SupabaseClient } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { DeviceContext } from '@/db/commands/context';
import { groupPermissions } from '@/db/permissions';
import type { HanafyDB } from '@/db/schema';
import { checkPin } from '@/db/workers';
import { resolveAccess, type Access, type Action } from '@/domain/permissions';
import type { SyncRunner } from '@/sync/runner';

import type { DeviceIdentity } from './device-setup';

export interface Services {
  db: HanafyDB;
  client: SupabaseClient;
  identity: DeviceIdentity;
  runner: SyncRunner;
}

export interface CurrentWorker {
  id: string;
  name: string;
  role: 'cashier' | 'storekeeper' | 'manager';
  groupId?: string | null;
}

interface SessionValue {
  worker: CurrentWorker | null;
  /** what the logged-in worker may do (his permission group, else his role); 'no' while nobody is logged in */
  can: (action: Action) => Access;
  /** checks the PIN locally (works offline): 'locked' after 5 wrong tries for 5 minutes */
  login: (worker: CurrentWorker, pin: string) => Promise<'ok' | 'wrong' | 'locked'>;
  lock: () => void;
  /** what commands need; null while nobody is logged in */
  context: DeviceContext | null;
}

const ServicesContext = createContext<Services | null>(null);
const SessionContext = createContext<SessionValue | null>(null);

export const useServices = (): Services => {
  const v = useContext(ServicesContext);
  if (!v) throw new Error('useServices outside ServicesProvider');
  return v;
};

export const useSession = (): SessionValue => {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
};

const DEFAULT_IDLE_MINUTES = 10;

export function SessionProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [worker, setWorker] = useState<CurrentWorker | null>(null);
  const idleMs = useRef(DEFAULT_IDLE_MINUTES * 60_000);

  // the worker's group is read live: a manager changing it applies at once, also to a worker who is logged in
  const live = useLiveQuery(async () => {
    if (!worker) return null;
    const fresh = await services.db.workers.get(worker.id);
    return { permissions: await groupPermissions(services.db, fresh?.groupId ?? worker.groupId) };
  }, [worker?.id, services]);
  const permissions = live?.permissions ?? null;

  const context = useMemo<DeviceContext | null>(
    () =>
      worker && live
        ? {
            db: services.db,
            companyId: services.identity.companyId,
            deviceId: services.identity.deviceId,
            devicePrefix: services.identity.prefix,
            workerId: worker.id,
            role: worker.role,
            permissions,
          }
        : null,
    [worker, live, permissions, services],
  );

  const login = useCallback(
    async (w: CurrentWorker, pin: string): Promise<'ok' | 'wrong' | 'locked'> => {
      const probe: DeviceContext = {
        db: services.db,
        companyId: services.identity.companyId,
        deviceId: services.identity.deviceId,
        devicePrefix: services.identity.prefix,
        workerId: w.id,
        role: w.role,
      };
      const result = await checkPin(probe, w.id, pin);
      if (result.ok) {
        setWorker(w);
        return 'ok';
      }
      return result.code === 'PIN_LOCKED' ? 'locked' : 'wrong';
    },
    [services],
  );

  useEffect(() => {
    void services.db.deviceSettings.get('idleLockMinutes').then((row) => {
      if (typeof row?.value === 'number' && row.value > 0) idleMs.current = row.value * 60_000;
    });
  }, [services, worker]); // read again at every login so a changed setting applies at once

  // screen lock after idle time (docs/SECURITY.md §2); any touch, key or pointer resets it
  useEffect(() => {
    if (!worker) return;
    let timer = setTimeout(() => setWorker(null), idleMs.current);
    const reset = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => setWorker(null), idleMs.current);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, reset);
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [worker]);

  const can = useCallback(
    (action: Action): Access => (worker ? resolveAccess(worker.role, permissions, action) : 'no'),
    [worker, permissions],
  );
  const value = useMemo<SessionValue>(
    () => ({ worker, can, login, lock: () => setWorker(null), context }),
    [worker, can, login, context],
  );
  return (
    <ServicesContext.Provider value={services}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </ServicesContext.Provider>
  );
}
