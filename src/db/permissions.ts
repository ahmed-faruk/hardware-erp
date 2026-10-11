import { resolveAccess, type Access, type Action, type Permissions, type Role } from '@/domain/permissions';

import type { HanafyDB } from './schema';

/** The permissions of a worker's group, or null (no group, or the group was deleted: his role's defaults apply). */
export async function groupPermissions(
  db: HanafyDB,
  groupId: string | null | undefined,
): Promise<Permissions | null> {
  if (!groupId) return null;
  const g = await db.permissionGroups.get(groupId);
  return g && !g.deletedAt ? g.permissions : null;
}

/** What a worker may do, as the server's worker_can() answers it. */
export async function workerAccess(
  db: HanafyDB,
  worker: { role: Role; groupId?: string | null },
  action: Action,
): Promise<Access> {
  return resolveAccess(worker.role, await groupPermissions(db, worker.groupId), action);
}
