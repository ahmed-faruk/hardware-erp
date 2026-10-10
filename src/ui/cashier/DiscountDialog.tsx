import { useState } from 'react';

import { toPiasters } from '@/domain/money';
import type { Discount } from '@/domain/totals';

import { ActionButton } from '../components/ActionButton';
import { strings } from '../strings.ar';

import { NumEntry } from './NumEntry';

/** Discount as a percent or an amount, typed on the number pad. `5.5` percent is 550 basis points (same two-decimal parser as money). */
export function DiscountDialog({
  open,
  onCancel,
  onApply,
}: {
  open: boolean;
  onCancel: () => void;
  onApply: (discount: Discount) => void;
}) {
  const [kind, setKind] = useState<'percentBp' | 'fixed'>('percentBp');
  return (
    <NumEntry
      title={strings.sell.discount}
      open={open}
      decimals={2}
      hint={kind === 'percentBp' ? strings.sell.percent : strings.sell.amount}
      extra={
        <>
          <ActionButton
            big
            label={strings.sell.percent}
            variant={kind === 'percentBp' ? 'primary' : 'ghost'}
            onClick={() => setKind('percentBp')}
            testId="kind-percent"
          />
          <ActionButton
            big
            label={strings.sell.amount}
            variant={kind === 'fixed' ? 'primary' : 'ghost'}
            onClick={() => setKind('fixed')}
            testId="kind-amount"
          />
        </>
      }
      onCancel={onCancel}
      onSubmit={(text) => {
        const v = toPiasters(text);
        if (v.ok && v.value > 0)
          onApply(kind === 'percentBp' ? { kind, valueBp: v.value } : { kind, value: v.value });
        else onCancel();
      }}
    />
  );
}
