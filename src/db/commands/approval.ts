import { err, ok, type Result } from '@/domain/result';
import type { Action } from '@/domain/permissions';

import type { DeviceContext } from './context';
import { uuidv7 } from '../ids';
import { checkPin } from '../workers';

export const APPROVAL_TTL_MS = 2 * 60 * 1000;

export interface Approval {
  /** single-use, 2 minutes (docs/SECURITY.md §2) */
  token: string;
  action: Action;
  approvedBy: string;
  expiresAt: number;
}

const issued = new Map<string, Approval>();

/** A manager types the PIN on this device; the result is a single-use token for ONE action (docs/API.md §6). */
export async function approveWithPin(
  ctx: DeviceContext,
  managerId: string,
  pin: string,
  action: Action,
  nowMs: number = Date.now(),
): Promise<Result<Approval>> {
  const manager = await ctx.db.workers.get(managerId);
  if (!manager || !manager.active || manager.deletedAt || manager.role !== 'manager')
    return err('E_FORBIDDEN', 'غير مسموح');
  const checked = await checkPin(ctx, managerId, pin, nowMs);
  if (!checked.ok) return checked;
  const approval: Approval = {
    token: uuidv7(),
    action,
    approvedBy: managerId,
    expiresAt: nowMs + APPROVAL_TTL_MS,
  };
  issued.set(approval.token, approval);
  return ok(approval);
}

/** Checks a token without spending it (the sale spends it only after every other check passed). */
export function peekApproval(token: string, action: Action, nowMs: number = Date.now()): Approval | null {
  const a = issued.get(token);
  return a && a.action === action && a.expiresAt > nowMs ? a : null;
}

export function spendApproval(token: string): void {
  issued.delete(token);
}
