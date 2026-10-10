import type { HanafyDB } from '@/db/schema';

import { callRpc } from './errors';
import type { RpcClient } from './supabase';

/** `navigator.onLine === false` is certain; otherwise only a successful ping proves we are online. */
export async function checkOnline(
  db: HanafyDB,
  client: RpcClient,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const res = await callRpc<{ server_time: string }>(client, 'ping', {});
  if (!res.ok) return false;
  await db.syncState.bulkPut([
    { key: 'clockSkewMs', value: Date.parse(res.data.server_time) - nowMs },
    { key: 'lastPingAt', value: nowMs },
  ]);
  return true;
}

export { isClockSafe, MAX_CLOCK_SKEW_MS, recordLocalTime } from '@/db/clock';
