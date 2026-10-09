import type { Role } from '@/domain/permissions';

import { nowIso, uuidv7 } from '../ids';
import type { HanafyDB } from '../schema';
import type { Common } from '../types';

/** Who is acting, on which device. Commands never read global state. */
export interface DeviceContext {
  db: HanafyDB;
  companyId: string;
  deviceId: string;
  devicePrefix: string;
  workerId: string;
  role: Role;
}

export function newCommon(ctx: DeviceContext): Common {
  const now = nowIso();
  return {
    id: uuidv7(),
    companyId: ctx.companyId,
    deviceId: ctx.deviceId,
    createdBy: ctx.workerId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
  };
}
