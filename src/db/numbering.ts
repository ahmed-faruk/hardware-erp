import { formatDocNumber, type DocType } from '@/domain/numbering';

import type { HanafyDB } from './schema';

/** Allocates the next number for this device and type. Call it INSIDE the document's transaction so gaps cannot happen. */
export async function nextNumber(db: HanafyDB, devicePrefix: string, type: DocType): Promise<string> {
  const row = await db.numberSequences.get(type);
  const seq = row?.next ?? 1;
  await db.numberSequences.put({ type, next: seq + 1 });
  return formatDocNumber(devicePrefix, type, seq);
}
