import { resolveAccess, type Access, type Action, type Permissions, type Role } from '@/domain/permissions';

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
  /** the worker's permission group; null/absent = the role's defaults */
  permissions?: Permissions | null;
}

/** Access of the acting worker to an action: his group when he has one, else his role. */
export const canCtx = (ctx: Pick<DeviceContext, 'role' | 'permissions'>, action: Action): Access =>
  resolveAccess(ctx.role, ctx.permissions ?? null, action);

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

/**
 * The role value the approval rules (discountNeedsApproval, priceNeedsApproval, adjustmentNeedsApproval) see: 'manager' when the
 * worker may do `action` outright (no PIN needed), otherwise a non-manager role.
 */
export const approvalRole = (ctx: Pick<DeviceContext, 'role' | 'permissions'>, action: Action): Role =>
  canCtx(ctx, action) === 'yes' ? 'manager' : ctx.role === 'manager' ? 'cashier' : ctx.role;
