import { err, ok, type Result } from '@/domain/result';

import { newCommon, type DeviceContext } from './commands/context';
import { enqueue } from './outbox';
import { nowIso } from './ids';

const ITERATIONS = 210_000;
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

export const isValidPin = (pin: string): boolean => /^\d{6,12}$/.test(pin);

/** PBKDF2-SHA256, 210,000 iterations, per-worker salt (docs/SECURITY.md §2). */
export async function hashPin(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { pinHash: await derive(pin, salt), pinSalt: b64(salt) };
}

interface Attempts {
  count: number;
  lockedUntil: number;
}

/** Checks a worker PIN locally. 5 wrong tries lock the worker for 5 minutes and leave an audit row. */
export async function checkPin(
  ctx: DeviceContext,
  workerId: string,
  pin: string,
  nowMs: number = Date.now(),
): Promise<Result<true>> {
  const { db } = ctx;
  const key = `pinAttempts:${workerId}`;
  const state = ((await db.deviceSettings.get(key))?.value as Attempts | undefined) ?? {
    count: 0,
    lockedUntil: 0,
  };
  if (state.lockedUntil > nowMs) return err('PIN_LOCKED', 'الرقم السري مقفول مؤقتًا');
  const worker = await db.workers.get(workerId);
  if (!worker || !worker.active || !worker.pinHash || !worker.pinSalt)
    return err('PIN_WRONG', 'الرقم السري غلط');
  if ((await derive(pin, unb64(worker.pinSalt))) === worker.pinHash) {
    await db.deviceSettings.put({ key, value: { count: 0, lockedUntil: 0 } });
    return ok(true);
  }
  const count = state.count + 1;
  const locked = count >= MAX_TRIES;
  await db.transaction('rw', [db.deviceSettings, db.auditLog, db.outbox, db.syncState], async () => {
    await db.deviceSettings.put({
      key,
      value: { count: locked ? 0 : count, lockedUntil: locked ? nowMs + LOCK_MS : 0 },
    });
    if (locked) {
      const audit = {
        ...newCommon(ctx),
        createdBy: null,
        action: 'pin_locked',
        entity: 'workers',
        entityId: workerId,
        before: null,
        after: null,
        workerId,
        approvedBy: null,
        occurredAt: nowIso(),
      };
      await db.auditLog.add(audit);
      await enqueue(db, 'auditLog', audit, workerId);
    }
  });
  return err('PIN_WRONG', 'الرقم السري غلط');
}
