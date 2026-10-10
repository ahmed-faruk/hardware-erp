import { tokenize } from '@/domain/arabic';

import type { HanafyDB } from './schema';
import type { Product } from './types';

/** Candidates kept after intersecting the words; keeps a one-letter query fast on 20,000 products. */
const MAX_CANDIDATES = 500;

const live = (p: Product | undefined): p is Product => !!p && !p.deletedAt;

/** Index words of one product: name, sku and every active barcode. */
export async function tokensOf(db: HanafyDB, productId: string): Promise<Set<string>> {
  const product = await db.products.get(productId);
  if (!live(product)) return new Set();
  const codes = (await db.barcodes.where('productId').equals(productId).toArray())
    .filter((b) => !b.deletedAt)
    .map((b) => b.code);
  return new Set(tokenize([product.name, product.sku ?? '', ...codes].join(' ')));
}

async function mutate(db: HanafyDB, token: string, productId: string, add: boolean): Promise<void> {
  const row = await db.searchIndex.get(token);
  const ids = new Set(row?.productIds ?? []);
  if (add) ids.add(productId);
  else ids.delete(productId);
  if (ids.size === 0) await db.searchIndex.delete(token);
  else await db.searchIndex.put({ token, productIds: [...ids] });
}

/** After a write: removes the product from words it no longer has and adds the new ones. Run inside the write's transaction. */
export async function patchIndex(db: HanafyDB, productId: string, before: Set<string>): Promise<void> {
  const after = await tokensOf(db, productId);
  for (const token of before) if (!after.has(token)) await mutate(db, token, productId, false);
  for (const token of after) if (!before.has(token)) await mutate(db, token, productId, true);
}

/**
 * Same as `patchIndex` for many products at once (a pulled page): every word's row is read and written once, not once per product.
 * A word that all products share ("دهان") would otherwise be rewritten 20,000 times with a 20,000-id list on the first sync.
 */
export async function patchIndexMany(db: HanafyDB, before: Map<string, Set<string>>): Promise<void> {
  const changes = new Map<string, { add: Set<string>; remove: Set<string> }>();
  const slot = (token: string): { add: Set<string>; remove: Set<string> } =>
    changes.get(token) ?? changes.set(token, { add: new Set(), remove: new Set() }).get(token)!;
  for (const [productId, was] of before) {
    const now = await tokensOf(db, productId);
    for (const token of was) if (!now.has(token)) slot(token).remove.add(productId);
    for (const token of now) if (!was.has(token)) slot(token).add.add(productId);
  }
  for (const [token, { add, remove }] of changes) {
    const row = await db.searchIndex.get(token);
    const ids = new Set(row?.productIds ?? []);
    for (const id of remove) ids.delete(id);
    for (const id of add) ids.add(id);
    if (ids.size === 0) await db.searchIndex.delete(token);
    else await db.searchIndex.put({ token, productIds: [...ids] });
  }
}

/** Full rebuild (first run, or after a restore). */
export async function rebuildSearchIndex(db: HanafyDB): Promise<void> {
  const index = new Map<string, Set<string>>();
  const add = (token: string, id: string): void =>
    void (index.get(token) ?? index.set(token, new Set()).get(token))!.add(id);
  const products = (await db.products.toArray()).filter(live);
  const ids = new Set(products.map((p) => p.id));
  for (const p of products) for (const t of tokenize(`${p.name} ${p.sku ?? ''}`)) add(t, p.id);
  for (const b of await db.barcodes.toArray())
    if (!b.deletedAt && ids.has(b.productId)) for (const t of tokenize(b.code)) add(t, b.productId);
  await db.transaction('rw', db.searchIndex, async () => {
    await db.searchIndex.clear();
    await db.searchIndex.bulkPut([...index].map(([token, set]) => ({ token, productIds: [...set] })));
  });
}

export interface SearchOptions {
  limit?: number;
  /** managers also look for products that are switched off */
  includeInactive?: boolean;
}

/** Products matching every word of the text as a word prefix (name, sku or barcode), best matches first by name. */
export async function searchProducts(
  db: HanafyDB,
  text: string,
  options: SearchOptions = {},
): Promise<Product[]> {
  const words = tokenize(text);
  if (words.length === 0) return [];
  let candidates: string[] | null = null;
  for (const word of words) {
    const hit = new Set<string>();
    for (const row of await db.searchIndex.where('token').startsWith(word).toArray())
      for (const id of row.productIds) hit.add(id);
    candidates = candidates === null ? [...hit] : candidates.filter((id) => hit.has(id));
    if (candidates.length === 0) return [];
  }
  const ids = (candidates ?? []).slice(0, MAX_CANDIDATES);
  const found = (await db.products.bulkGet(ids))
    .filter(live)
    .filter((p) => options.includeInactive || p.active);
  return found.sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, options.limit ?? 50);
}
