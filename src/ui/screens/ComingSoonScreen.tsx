import { Clock } from 'lucide-react';

import { EmptyState } from '../components/EmptyState';
import { strings } from '../strings.ar';

/** Cashier and storekeeper devices until the selling screens exist (next phase). */
export function ComingSoonScreen() {
  return (
    <>
      <EmptyState icon={Clock} word={strings.soon.title} />
      <p style={{ textAlign: 'center' }}>{strings.soon.body}</p>
    </>
  );
}
