import { useRef, useState, type ReactNode } from 'react';

import { useSession } from '@/app/session';
import { deleteBlock, deleteMaster, type DeleteKind } from '@/db/commands/delete-master';

import { UndoToast } from '../cashier/UndoToast';
import { BigAlert } from '../components/BigAlert';
import { strings } from '../strings.ar';

/** Delete a customer, supplier or worker: a block reason shows at once, otherwise 5 seconds to undo, then the soft delete. */
export function useMasterDelete(
  kind: DeleteKind,
  onDone?: () => void,
): { start: (id: string) => Promise<void>; view: ReactNode } {
  const { context } = useSession();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; word: string } | null>(null);
  const running = useRef(false);
  const t = strings.masterDelete;
  const word = (code: string): string =>
    code === 'HAS_BALANCE'
      ? t.hasBalance
      : code === 'HAS_ADVANCE'
        ? t.hasAdvance
        : code === 'SELF'
          ? t.self
          : t.failed;

  const start = async (id: string): Promise<void> => {
    setNotice(null);
    if (!context) return;
    const blocked = await deleteBlock(context, kind, id);
    if (blocked) return setNotice({ tone: 'danger', word: word(blocked.code) });
    setPending(id);
  };
  const run = (): void => {
    const id = pending;
    setPending(null);
    if (!context || !id || running.current) return;
    running.current = true;
    void deleteMaster(context, kind, id).then((r) => {
      running.current = false;
      if (r.ok) {
        setNotice({ tone: 'ok', word: t.done });
        onDone?.();
      } else setNotice({ tone: 'danger', word: word(r.code) });
    });
  };
  const view = (
    <>
      {notice && <BigAlert tone={notice.tone} word={notice.word} />}
      {pending && <UndoToast message={t.deleting} onUndo={() => setPending(null)} onExpire={run} />}
    </>
  );
  return { start, view };
}
