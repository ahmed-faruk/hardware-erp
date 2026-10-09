import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { saveSupplier } from '@/db/commands/save-master';
import { SyncRunner } from '@/sync/runner';
import type { RpcClient } from '@/sync/supabase';

import { newDevice } from './helpers';

type Handler = (args: Record<string, unknown>) => {
  data?: unknown;
  error?: { message: string; status?: number };
};

function fakeClient(handlers: Record<string, Handler>) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
      (handlers[name] ?? (() => ({ error: { message: `no ${name}` } })))(args),
    ),
  };
}
const ok = (data: unknown) => ({ data: { ok: true, data } });

describe('SyncRunner', () => {
  it('pings, pushes pending rows, pulls, and reports the state', async () => {
    const ctx = newDevice('K1', 'manager');
    await saveSupplier(ctx, { fields: { name: 'مورد' } });
    const client = fakeClient({
      ping: () => ok({ server_time: new Date().toISOString() }),
      ingest_batch: (a) => ok({ accepted_up_to: (a.p_rows as { seq: number }[]).at(-1)!.seq, rejected: [] }),
      pull_changes: () => ok({ rows: [], last_seq: 5, has_more: false }),
    });
    const runner = new SyncRunner(ctx.db, client as unknown as RpcClient, ctx.deviceId, {
      appVersion: 't',
      intervalMs: 1e9,
    });
    await runner.runOnce();
    expect(runner.getSnapshot()).toMatchObject({ online: true, syncing: false, revoked: false });
    expect(runner.getSnapshot().lastSyncAt).not.toBeNull();
    expect(await ctx.db.outbox.where('status').equals('pending').count()).toBe(0);
    expect((await ctx.db.syncState.get('lastServerSeq'))?.value).toBe(5);
    runner.stop();
  });

  it('stays offline and keeps the outbox when the ping fails', async () => {
    const ctx = newDevice('K1', 'manager');
    await saveSupplier(ctx, { fields: { name: 'مورد' } });
    const client = fakeClient({ ping: () => ({ error: { message: 'fetch failed' } }) });
    const runner = new SyncRunner(ctx.db, client as unknown as RpcClient, ctx.deviceId, {
      appVersion: 't',
      intervalMs: 1e9,
    });
    await runner.runOnce();
    expect(runner.getSnapshot().online).toBe(false);
    expect(await ctx.db.outbox.where('status').equals('pending').count()).toBe(1);
    runner.stop();
  });

  it('stops for good when the device was revoked', async () => {
    const ctx = newDevice('K1', 'manager');
    await saveSupplier(ctx, { fields: { name: 'مورد' } });
    const client = fakeClient({
      ping: () => ok({ server_time: new Date().toISOString() }),
      ingest_batch: () => ({ error: { message: 'E_DEVICE_REVOKED' } }),
    });
    const runner = new SyncRunner(ctx.db, client as unknown as RpcClient, ctx.deviceId, {
      appVersion: 't',
      intervalMs: 1e9,
    });
    await runner.runOnce();
    expect(runner.getSnapshot().revoked).toBe(true);
    const calls = client.rpc.mock.calls.length;
    await runner.runOnce();
    expect(client.rpc.mock.calls.length).toBe(calls);
    runner.stop();
  });
});
