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
import { checkVerifier, hasVerifier, saveVerifier } from '@/db/login';
import { callRpc } from '@/sync/errors';
import { resolveAccess, type Access, type Action } from '@/domain/permissions';
import type { SyncRunner } from '@/sync/runner';

import type { DeviceIdentity } from './device-setup';

export interface Services {
  db: HanafyDB;
  client: SupabaseClient;
  identity: DeviceIdentity;
  runner: SyncRunner;
}

export type LoginResult = 'ok' | 'wrong' | 'locked' | 'needsNet' | { mustChange: string };

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
  /**
   * Username and password. Online the server checks them (5 wrong tries lock the username for 15 minutes); offline a worker who
   * logged in on this device before is checked against the verifier kept here. `mustChange`: the password has to be replaced first.
   */
  login: (username: string, password: string) => Promise<LoginResult>;
  /** the new password for a worker who must change it (online); logs them in */
  changePassword: (workerId: string, username: string, newPassword: string) => Promise<boolean>;
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

  const enter = useCallback(
    async (workerId: string): Promise<boolean> => {
      const w = await services.db.workers.get(workerId);
      if (!w || !w.active || w.deletedAt) return false;
      setWorker({ id: w.id, name: w.name, role: w.role, groupId: w.groupId ?? null });
      return true;
    },
    [services],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      // a dead connection must not hang the login: no connection or no answer within 5 seconds counts as offline
      const offline = { ok: false, code: 'E_INTERNAL', message: '', network: true } as const;
      const r =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? offline
          : await Promise.race([
              callRpc<{ worker_id: string; must_change: boolean }>(services.client, 'verify_worker_login', {
                p_username: username.trim(),
                p_password: password,
              }),
              new Promise<typeof offline>((resolve) => setTimeout(() => resolve(offline), 5000)),
            ]);
      if (r.ok) {
        if (r.data.must_change) return { mustChange: r.data.worker_id };
        await saveVerifier(services.db, username, r.data.worker_id, password);
        return (await enter(r.data.worker_id)) ? 'ok' : 'wrong';
      }
      if (r.code === 'E_LOCKED') return 'locked';
      if (!r.network) return 'wrong';
      // no internet: a worker who logged in on this device before is checked against the saved verifier
      const workerId = await checkVerifier(services.db, username, password);
      if (workerId) return (await enter(workerId)) ? 'ok' : 'wrong';
      return (await hasVerifier(services.db, username)) ? 'wrong' : 'needsNet';
    },
    [services, enter],
  );

  const changePassword = useCallback(
    async (workerId: string, username: string, newPassword: string): Promise<boolean> => {
      const r = await callRpc<{ username: string }>(services.client, 'set_worker_login', {
        p_actor: workerId,
        p_worker: workerId,
        p_username: null,
        p_password: newPassword,
      });
      if (!r.ok) return false;
      await saveVerifier(services.db, username, workerId, newPassword);
      return enter(workerId);
    },
    [services, enter],
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
    () => ({ worker, can, login, changePassword, lock: () => setWorker(null), context }),
    [worker, can, login, changePassword, context],
  );
  return (
    <ServicesContext.Provider value={services}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </ServicesContext.Provider>
  );
}
