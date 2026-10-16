import { useState } from 'react';

import { useSession } from '@/app/session';
import { voidPurchaseInvoice } from '@/db/commands/purchasing';
import { voidInvoice, type VOID_REASONS } from '@/db/commands/returns';

import { BigAlert } from '../components/BigAlert';
import { VoidReasonDialog } from '../components/VoidReasonDialog';
import { strings } from '../strings.ar';

/** Deleting (voiding) a sales or purchase invoice from a manager screen: the reason list, the command and the answer. */
export function useInvoiceDelete(kind: 'sale' | 'purchase', onDone?: () => void) {
  const { context, can } = useSession();
  const [target, setTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; word: string } | null>(null);
  const allowed = can(kind === 'sale' ? 'void' : 'voidPurchase') === 'yes';

  const run = async (reason: (typeof VOID_REASONS)[number]): Promise<void> => {
    const id = target;
    setTarget(null);
    if (!context || !id) return;
    if (kind === 'sale') {
      const r = await voidInvoice(context, { invoiceId: id, reason, shiftId: null });
      if (r.ok) setNotice({ tone: 'ok', word: strings.voidInvoice.done });
      else
        setNotice({
          tone: 'danger',
          word:
            r.code === 'HAS_RETURNS'
              ? strings.voidInvoice.hasReturns
              : r.code === 'ALREADY_VOIDED'
                ? strings.voidInvoice.already
                : r.code === 'NO_SHIFT'
                  ? strings.voidInvoice.noShift
                  : strings.errors.saveFailed,
        });
      if (r.ok) onDone?.();
      return;
    }
    const r = await voidPurchaseInvoice(context, { invoiceId: id, reason });
    if (r.ok) {
      setNotice({ tone: 'ok', word: strings.voidPurchase.done });
      onDone?.();
    } else
      setNotice({
        tone: 'danger',
        word:
          r.code === 'HAS_RETURNS'
            ? strings.voidPurchase.hasReturns
            : r.code === 'ALREADY_VOIDED'
              ? strings.voidPurchase.already
              : r.code === 'STOCK_SOLD'
                ? strings.voidPurchase.stockSold
                : r.code === 'LEGACY'
                  ? strings.voidPurchase.legacy
                  : strings.voidPurchase.failed,
      });
  };

  return {
    allowed,
    request: (id: string) => {
      setNotice(null);
      setTarget(id);
    },
    notice: notice ? <BigAlert tone={notice.tone} word={notice.word} /> : null,
    dialog: (
      <VoidReasonDialog
        open={target !== null}
        title={kind === 'sale' ? strings.voidInvoice.title : strings.voidPurchase.title}
        onPick={(r) => void run(r)}
        onClose={() => setTarget(null)}
      />
    ),
  };
}
