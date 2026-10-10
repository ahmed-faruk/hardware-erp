import { liveQuery } from 'dexie';

import type { HanafyDB } from '@/db/schema';

import { checkOnline, recordLocalTime } from './connectivity';
import { backoffMs } from './errors';
import { pullAll } from './pull';
import { pushAll } from './push';
import type { RpcClient } from './supabase';

export interface SyncSnapshot {
  online: boolean;
  pending: number;
  lastSyncAt: number | null;
  syncing: boolean;
  /** the manager revoked this device: sync stops and local data is wiped at the next start */
  revoked: boolean;
}

export interface RunnerOptions {
  appVersion: string;
  /** how often to ping and pull when nothing else triggers a sync (docs/ARCHITECTURE.md §4: every 30 s) */
  intervalMs?: number;
}

/** Pushes the outbox and pulls changes whenever the device is online. Selling never waits for it. */
export class SyncRunner {
  private snapshot: SyncSnapshot = {
    online: false,
    pending: 0,
    lastSyncAt: null,
    syncing: false,
    revoked: false,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscription: { unsubscribe(): void } | null = null;
  private failures = 0;
  private running = false;
  private stopped = true;

  constructor(
    private readonly db: HanafyDB,
    private readonly client: RpcClient,
    private readonly deviceId: string,
    private readonly options: RunnerOptions,
  ) {}

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  async start(): Promise<void> {
    this.stopped = false;
    const last = await this.db.syncState.get('lastSyncAt');
    if (typeof last?.value === 'number') this.set({ lastSyncAt: last.value });
    this.subscription = liveQuery(() => this.db.outbox.where('status').equals('pending').count()).subscribe(
      (pending) => {
        this.set({ pending });
        if (pending > 0) this.schedule(1000);
      },
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    this.subscription?.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }

  private onOnline = (): void => this.schedule(0);
  private onOffline = (): void => this.set({ online: false });

  private schedule(delay: number): void {
    if (this.stopped || this.snapshot.revoked) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runOnce(), delay);
  }

  /** One round: ping, push, pull. Public so tests (and a "sync now" button) can call it. */
  async runOnce(): Promise<void> {
    if (this.running || this.snapshot.revoked) return;
    this.running = true;
    this.set({ syncing: true });
    let nextDelay = this.options.intervalMs ?? 30_000;
    try {
      await recordLocalTime(this.db);
      const online = await checkOnline(this.db, this.client);
      this.set({ online });
      if (!online) {
        nextDelay = backoffMs(this.failures++);
        return;
      }
      const pushed = await pushAll(this.db, this.client, this.deviceId, this.options.appVersion);
      const pulled = pushed.error ? null : await pullAll(this.db, this.client);
      const error = pushed.error ?? (pulled && !pulled.ok ? pulled : null);
      if (error) {
        if (error.code === 'E_DEVICE_REVOKED') {
          this.set({ revoked: true });
          return;
        }
        nextDelay = backoffMs(this.failures++);
        if (error.network) this.set({ online: false });
        return;
      }
      this.failures = 0;
      const lastSyncAt = Date.now();
      await this.db.syncState.put({ key: 'lastSyncAt', value: lastSyncAt });
      this.set({ lastSyncAt });
    } finally {
      this.running = false;
      this.set({ syncing: false });
      this.schedule(nextDelay);
    }
  }
}
