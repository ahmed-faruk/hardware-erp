import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';
import { useState } from 'react';

import { useServices } from '@/app/session';
import { loadPartyStatement } from '@/db/statement';
import { loadDeviceSettings } from '@/db/settings';
import { formatMoney } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { Dialog } from '../components/Dialog';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

const cairoDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const PERIODS = [
  { key: 'month', days: 30 },
  { key: 'quarter', days: 90 },
  { key: 'all', days: 36500 },
] as const;

export function StatementDialog({
  open,
  partyType,
  party,
  onClose,
}: {
  open: boolean;
  partyType: 'customer' | 'supplier';
  party: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog title={strings.statement.title} open={open} onClose={onClose}>
      {party && <Body partyType={partyType} party={party} />}
    </Dialog>
  );
}

function Body({
  partyType,
  party,
}: {
  partyType: 'customer' | 'supplier';
  party: { id: string; name: string };
}) {
  const { db } = useServices();
  const [days, setDays] = useState<number>(30);
  const [now] = useState(() => Date.now());
  const to = cairoDate(new Date(now));
  const from = cairoDate(new Date(now - days * 86_400_000));
  const statement = useLiveQuery(
    () => loadPartyStatement(db, partyType, party.id, { from, to }),
    [db, partyType, party.id, from, to],
  );

  const print = async (): Promise<void> => {
    if (!statement) return;
    const [render, { printHtml, cairoFontFaces }, device, company] = await Promise.all([
      import('../print/render'),
      import('../print/printHtml'),
      loadDeviceSettings(db),
      db.companies.toCollection().first(),
    ]);
    await printHtml(
      render.renderStatementHtml(
        {
          shopName: company?.name ?? '',
          partyName: party.name,
          period: { from, to },
          statement,
          digits: device.digits,
        },
        cairoFontFaces(),
      ),
    );
  };

  return (
    <div className={styles.form}>
      <h2>{party.name}</h2>
      <div className={styles.actions}>
        {PERIODS.map((p) => (
          <ActionButton
            key={p.key}
            label={strings.statement[p.key]}
            variant={days === p.days ? 'primary' : 'ghost'}
            onClick={() => setDays(p.days)}
            testId={`period-${p.key}`}
          />
        ))}
      </div>
      {statement && (
        <>
          <p>
            {strings.receipt.opening}: <strong>{formatMoney(statement.opening)}</strong>
          </p>
          <table data-testid="statement-table">
            <tbody>
              {statement.rows.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr">{r.docNumber}</td>
                  <td dir="ltr">{formatMoney(r.amount)}</td>
                  <td dir="ltr">{formatMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            {strings.receipt.closing}:{' '}
            <strong data-testid="statement-closing">{formatMoney(statement.closing)}</strong>
          </p>
          <ActionButton
            label={strings.statement.print}
            icon={Printer}
            onClick={() => void print()}
            testId="print-statement"
          />
        </>
      )}
    </div>
  );
}
