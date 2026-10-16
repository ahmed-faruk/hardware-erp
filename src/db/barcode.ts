import { makeInternalBarcode } from '@/domain/barcode';

import type { HanafyDB } from './schema';

/** A fresh shop-made barcode that no live barcode on this device uses. */
export async function generateBarcode(db: HanafyDB, random: () => number = Math.random): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = makeInternalBarcode(random);
    const taken = await db.barcodes
      .where('code')
      .equals(code)
      .filter((b) => !b.deletedAt)
      .count();
    if (taken === 0) return code;
  }
  throw new Error('no free barcode');
}
