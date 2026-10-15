import type { HanafyDB } from './schema';

/** An invoice being typed, kept on THIS device only (deviceSettings is never synced) so a closed screen loses nothing. */
export interface PurchaseDraft {
  supplierId: string;
  supplierRef: string;
  discount: number;
  mode: 'cash' | 'credit' | 'mix';
  paid: number | null;
  ownerPaid: number | null;
  rows: {
    productId: string;
    unitId: string | null;
    qty: number;
    cost: number | null;
    price: number | null;
  }[];
  savedAt: string;
}

const KEY = 'purchaseDraft';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What is stored is untrusted JSON: anything malformed is dropped. */
export function parseDraft(value: unknown): PurchaseDraft | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (!Array.isArray(d.rows)) return null;
  const rows = d.rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter((r) => typeof r.productId === 'string' && isNum(r.qty) && r.qty > 0)
    .map((r) => ({
      productId: r.productId as string,
      unitId: typeof r.unitId === 'string' ? r.unitId : null,
      qty: r.qty as number,
      cost: isNum(r.cost) ? r.cost : null,
      price: isNum(r.price) ? r.price : null,
    }));
  return {
    supplierId: typeof d.supplierId === 'string' ? d.supplierId : '',
    supplierRef: typeof d.supplierRef === 'string' ? d.supplierRef : '',
    discount: isNum(d.discount) && d.discount >= 0 ? d.discount : 0,
    mode: d.mode === 'cash' || d.mode === 'credit' ? d.mode : 'mix',
    paid: isNum(d.paid) ? d.paid : null,
    ownerPaid: isNum(d.ownerPaid) ? d.ownerPaid : null,
    rows,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
  };
}

export async function loadDraft(db: HanafyDB): Promise<PurchaseDraft | null> {
  return parseDraft((await db.deviceSettings.get(KEY))?.value);
}

// writes and deletes of the draft run one after the other: a slow save can never land after a discard
let queue: Promise<unknown> = Promise.resolve();
const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
};

/** An empty draft (no supplier, no lines, no reference) is not worth keeping: it is dropped. Returns whether something was stored. */
export function saveDraft(db: HanafyDB, draft: PurchaseDraft): Promise<boolean> {
  return inOrder(async () => {
    if (!draft.supplierId && draft.rows.length === 0 && !draft.supplierRef) {
      await db.deviceSettings.delete(KEY);
      return false;
    }
    await db.deviceSettings.put({ key: KEY, value: draft });
    return true;
  });
}

export function clearDraft(db: HanafyDB): Promise<void> {
  return inOrder(async () => {
    await db.deviceSettings.delete(KEY);
  });
}
