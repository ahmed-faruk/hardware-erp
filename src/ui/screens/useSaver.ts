import { useState } from 'react';

import type { Err } from '@/domain/result';

import { strings } from '../strings.ar';

/** Maps a command error code to the short Arabic word shown in the alert. */
export function errorWord(code: string): string {
  switch (code) {
    case 'DUPLICATE_BARCODE':
      return strings.products.duplicateBarcode;
    case 'E_CONFLICT':
      return strings.errors.conflict;
    case 'E_FORBIDDEN':
      return strings.forbidden;
    case 'E_VALIDATION':
      return strings.errors.invalid;
    default:
      return strings.errors.saveFailed;
  }
}

/** Runs a save command, tracks busy and error, and calls `onDone` only on success. */
export function useSaver(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (save: () => Promise<{ ok: true } | Err>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await save();
      if (result.ok) onDone();
      else setError(errorWord(result.code));
    } catch {
      setError(strings.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, clearError: () => setError(null) };
}
