import type { SupabaseClient } from '@supabase/supabase-js';
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
import type { HanafyDB } from '@/db/schema';
import { checkPin } from '@/db/workers';
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
}

interface SessionValue {
  worker: CurrentWorker | null;
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

  const context = useMemo<DeviceContext | null>(
    () =>
      worker && {
        db: services.db,
        companyId: services.identity.companyId,
        deviceId: services.identity.deviceId,
        devicePrefix: services.identity.prefix,
        workerId: worker.id,
        role: worker.role,
      },
    [worker, services],
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

  const value = useMemo<SessionValue>(
    () => ({ worker, login, lock: () => setWorker(null), context }),
    [worker, login, context],
  );
  return (
    <ServicesContext.Provider value={services}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </ServicesContext.Provider>
  );
}
