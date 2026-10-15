import { useLiveQuery } from 'dexie-react-hooks';

import { useServices } from '@/app/session';

import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

export function useBasics() {
  const { db } = useServices();
  return useLiveQuery(async () => {
    const warehouse = (await db.warehouses.filter((w) => w.kind === 'main' && !w.deletedAt).first()) ?? null;
    const safe = (await db.cashAccounts.filter((a) => a.kind === 'safe' && !a.deletedAt).first()) ?? null;
    const suppliers = await db.suppliers
      .orderBy('name')
      .filter((s) => !s.deletedAt && s.active)
      .toArray();
    return { warehouse, safe, suppliers };
  }, [db]);
}

export function SupplierSelect({
  value,
  onChange,
  suppliers,
}: {
  value: string;
  onChange: (id: string) => void;
  suppliers: { id: string; name: string }[];
}) {
  return (
    <FormField label={strings.purchases.supplier}>
      {(id) => (
        <select
          id={id}
          className="control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="purchase-supplier"
        >
          <option value="">{strings.purchases.pickSupplier}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
