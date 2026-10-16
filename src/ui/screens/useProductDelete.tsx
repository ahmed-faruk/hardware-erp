import { useRef, useState, type ReactNode } from 'react';

import { useServices, useSession } from '@/app/session';
import { archiveProduct } from '@/db/commands/archive-product';
import { deleteProduct } from '@/db/commands/delete-product';
import { localProductUsage } from '@/db/product-usage';
import { mergeUsage, usageFromServer, usageReasons, type UsageReason } from '@/domain/product-usage';
import { callRpc } from '@/sync/errors';

import { UndoToast } from '../cashier/UndoToast';
import { BigAlert } from '../components/BigAlert';
import { strings } from '../strings.ar';

/**
 * Delete or archive a product from anywhere (the product screen or the products grid): the server is asked first (the old history
 * lives there), a product that never moved is deleted, one with history is archived (only at stock 0, only for archiveProduct),
 * and the user has 5 seconds to undo before it happens.
 */
export function useProductDelete(onDone?: () => void): {
  start: (productId: string, name: string) => Promise<void>;
  busy: boolean;
  /** what the screen shows: the reasons it cannot be deleted, a note, and the undo toast */
  view: ReactNode;
} {
  const { db, client } = useServices();
  const { context, can } = useSession();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; reasons: UsageReason[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<'delete' | 'archive' | null>(null);
  const running = useRef(false);

  const start = async (id: string, name: string): Promise<void> => {
    setBlocked(null);
    setNote(null);
    setTarget({ id, name });
    const r = await callRpc<Record<string, unknown>>(client, 'product_usage', { p_product_id: id });
    if (!r.ok) return setNote(r.network ? strings.products.deleteNeedsNet : strings.errors.saveFailed);
    const reasons = usageReasons(mergeUsage(await localProductUsage(db, id), usageFromServer(r.data)));
    if (reasons.length === 0) return setPending('delete');
    if (can('archiveProduct') !== 'yes') return setBlocked({ name, reasons });
    if (reasons.includes('stock')) {
      setNote(strings.products.archiveNeedsZeroStock);
      return setBlocked({ name, reasons });
    }
    setPending('archive');
  };

  const run = (): void => {
    const mode = pending;
    setPending(null);
    if (!context || !target || !mode || running.current) return;
    running.current = true;
    void (mode === 'archive' ? archiveProduct(context, target.id) : deleteProduct(context, target.id)).then(
      (r) => {
        running.current = false;
        if (r.ok) {
          setTarget(null);
          return onDone?.();
        }
        const reasons = 'reasons' in r ? (r.reasons as UsageReason[] | undefined) : undefined;
        if (reasons) setBlocked({ name: target.name, reasons });
        else
          setNote(
            r.code === 'HAS_STOCK' ? strings.products.archiveNeedsZeroStock : strings.errors.saveFailed,
          );
      },
    );
  };

  const view = (
    <>
      {note && <BigAlert tone="warn" word={note} sound={false} />}
      {blocked && (
        <div data-testid="delete-blocked">
          <BigAlert
            tone="warn"
            word={`${blocked.name ? `${blocked.name} — ` : ''}${strings.products.deleteBlocked}: ${blocked.reasons
              .map((x) => strings.products.deleteReasons[x])
              .join(strings.cash.listSeparator)}`}
            sound={false}
          />
        </div>
      )}
      {pending && (
        <UndoToast
          message={pending === 'archive' ? strings.products.archiving : strings.products.deleting}
          onUndo={() => setPending(null)}
          onExpire={run}
        />
      )}
    </>
  );
  return { start, busy: pending !== null, view };
}
