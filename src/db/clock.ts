import type { HanafyDB } from './schema';

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Remembers the latest local time seen so a clock set backwards can be detected. */
export async function recordLocalTime(db: HanafyDB, nowMs: number = Date.now()): Promise<void> {
  const last = await db.syncState.get('lastLocalTimeMs');
  if (typeof last?.value !== 'number' || nowMs > last.value)
    await db.syncState.put({ key: 'lastLocalTimeMs', value: nowMs });
}

/** False when the device clock went backwards or is more than 5 min from the server: block opening a new shift. */
export async function isClockSafe(db: HanafyDB, nowMs: number = Date.now()): Promise<boolean> {
  const skew = (await db.syncState.get('clockSkewMs'))?.value;
  const last = (await db.syncState.get('lastLocalTimeMs'))?.value;
  if (typeof skew === 'number' && Math.abs(skew) > MAX_CLOCK_SKEW_MS) return false;
  if (typeof last === 'number' && nowMs < last) return false;
  return true;
}
