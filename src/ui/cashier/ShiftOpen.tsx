import { LockOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useSession } from '@/app/session';
import { openShift } from '@/db/commands/open-shift';
import type { CashAccount } from '@/db/types';
import { toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { strings } from '../strings.ar';

import { NumEntry } from './NumEntry';

import styles from './dialogs.module.css';

const ERRORS: Record<string, string> = {
  SHIFT_ALREADY_OPEN: strings.sell.shiftOpen,
  CLOCK_UNSAFE: strings.errors.invalid,
};

/** Sales are blocked until a shift is open with the counted float (FIN-02). One open shift per drawer. */
export function ShiftOpen({
  drawer,
  offer,
}: {
  drawer: CashAccount | null | undefined;
  /** the print button for the report of the shift that was just closed */
  offer?: ReactNode;
}) {
  const { context } = useSession();
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (drawer === null) return <BigAlert tone="warn" word={strings.sell.noDrawer} />;
  return (
    <div className={styles.stack} style={{ maxInlineSize: 480, marginInline: 'auto', paddingBlock: 48 }}>
      <p className={styles.lead}>{strings.sell.float}</p>
      <ActionButton
        label={strings.sell.openShift}
        icon={LockOpen}
        variant="ok"
        layout="stack"
        onClick={() => setEntering(true)}
        disabled={!drawer}
        testId="open-shift"
      />
      {error && <BigAlert tone="danger" word={error} />}
      {offer}
      <NumEntry
        title={strings.sell.float}
        open={entering}
        decimals={2}
        onCancel={() => setEntering(false)}
        onSubmit={(text) => {
          const float = toPiasters(text);
          if (!context || !drawer || !float.ok) return;
          setEntering(false);
          void openShift(context, { cashAccountId: drawer.id, openingFloat: float.value }).then((r) =>
            setError(r.ok ? null : (ERRORS[r.code] ?? strings.errors.saveFailed)),
          );
        }}
      />
    </div>
  );
}
