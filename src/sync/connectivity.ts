import type { HanafyDB } from '@/db/schema';

import { auditClock } from './clock-audit';
import { MAX_CLOCK_SKEW_MS } from '@/db/clock';
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
  const skew = Date.parse(res.data.server_time) - nowMs;
  await db.syncState.bulkPut([
    { key: 'clockSkewMs', value: skew },
    { key: 'lastPingAt', value: nowMs },
  ]);
  if (Math.abs(skew) > MAX_CLOCK_SKEW_MS) await auditClock(db, skew, nowMs);
  return true;
}

export { isClockSafe, MAX_CLOCK_SKEW_MS, recordLocalTime } from '@/db/clock';
