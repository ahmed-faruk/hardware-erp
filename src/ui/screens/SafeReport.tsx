import { useEffect, useState } from 'react';

import { useServices } from '@/app/session';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';
import type { SafeData, SafeDetail } from '@/domain/reports';
import { callRpc } from '@/sync/errors';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

const r = strings.reports;
const lineName = (k: string): string => r.safeLines[k] ?? k;

/** The safe report on screen: every section with its lines; each line opens the documents it was added up from. */
export function SafeReport({ data, from, to }: { data: SafeData; from: string; to: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = (k: string): number => data.sections.find((s) => s.key === k)?.total ?? 0;
  return (
    <>
      {data.sections.map((s) => (
        <div key={s.key} className={styles.section} data-testid={`safe-section-${s.key}`}>
          <h2>{r.safeSections[s.key] ?? s.key}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.reportTable}>
              <thead>
                <tr>
                  <th>{r.item}</th>
                  <th className={styles.num}>{r.count}</th>
                  <th className={styles.num}>{r.amount}</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setOpen(l.key)}
                        data-testid={`safe-line-${l.key}`}
                      >
                        {`${l.sign < 0 ? '− ' : ''}${lineName(l.key)}`}
                      </button>
                    </td>
                    <td dir="ltr" className={styles.num}>
                      {l.count}
                    </td>
                    <td dir="ltr" className={styles.num} data-testid={`safe-amount-${l.key}`}>
                      {formatMoney(l.amount)}
                    </td>
                  </tr>
                ))}
                {s.key !== 'excluded' && (
                  <tr className={styles.totalRow}>
                    <td>{r.total}</td>
                    <td />
                    <td dir="ltr" className={styles.num} data-testid={`safe-total-${s.key}`}>
                      {formatMoney(s.total)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className={styles.section} data-testid="safe-formula">
        <h2>{r.safeFormula.title}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.reportTable}>
            <tbody>
              {(['sales', 'purchases', 'expenses', 'payroll'] as const).map((k) => (
                <tr key={k}>
                  <td>{r.safeFormula[k]}</td>
                  <td dir="ltr" className={styles.num}>
                    {formatMoney(total(k))}
                  </td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td>{r.safeFormula.net}</td>
                <td dir="ltr" className={styles.num} data-testid="safe-formula-net">
                  {formatMoney(data.net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <SafeDetailDialog lineKey={open} from={from} to={to} onClose={() => setOpen(null)} />
    </>
  );
}

type DetailRow = SafeDetail['rows'][number] & { i: number };

/** The documents behind one line: how it is calculated, its count and total, and the rows (200 at a time). */
function SafeDetailDialog({
  lineKey,
  from,
  to,
  onClose,
}: {
  lineKey: string | null;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { client } = useServices();
  // the answer is kept with the request it belongs to, so a new line, period or reopening starts from nothing
  const reqKey = `${lineKey}|${from}|${to}`;
  const [answer, setAnswer] = useState<{
    key: string;
    detail: SafeDetail | null;
    error: 'offline' | 'failed' | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = r.safeDetail;
  const detail = answer?.key === reqKey ? answer.detail : null;
  const error = answer?.key === reqKey ? answer.error : null;

  useEffect(() => {
    if (!lineKey) return;
    let live = true;
    void callRpc<SafeDetail>(client, 'report_safe_detail', {
      p_from: from,
      p_to: to,
      p_key: lineKey,
      p_offset: 0,
    }).then((res) => {
      if (!live) return;
      setAnswer({
        key: reqKey,
        detail: res.ok ? res.data : null,
        error: res.ok ? null : res.network ? 'offline' : 'failed',
      });
    });
    return () => {
      live = false;
    };
  }, [client, lineKey, from, to, reqKey]);

  const more = async (): Promise<void> => {
    if (!lineKey || !detail) return;
    setBusy(true);
    const res = await callRpc<SafeDetail>(client, 'report_safe_detail', {
      p_from: from,
      p_to: to,
      p_key: lineKey,
      p_offset: detail.rows.length,
    });
    setBusy(false);
    setAnswer({
      key: reqKey,
      detail: res.ok ? { ...detail, rows: [...detail.rows, ...res.data.rows] } : detail,
      error: res.ok ? null : res.network ? 'offline' : 'failed',
    });
  };

  const rows: DetailRow[] = (detail?.rows ?? []).map((x, i) => ({ ...x, i }));
  const columns: Column<DetailRow>[] = [
    { key: 'at', header: d.date, cell: (x) => <span dir="ltr">{cairoTime(x.at)}</span> },
    { key: 'number', header: d.number, cell: (x) => <span dir="ltr">{x.number}</span> },
    { key: 'party', header: d.party, cell: (x) => x.party ?? '—' },
    {
      key: 'method',
      header: d.method,
      cell: (x) => (x.method ? ((strings.receipt.pay as Record<string, string>)[x.method] ?? x.method) : '—'),
    },
    { key: 'source', header: d.source, cell: (x) => r.safeSources[x.source] ?? x.source },
    { key: 'amount', header: d.amount, numeric: true, cell: (x) => formatMoney(x.amount) },
  ];

  return (
    <Dialog title={lineKey ? lineName(lineKey) : ''} open={lineKey !== null} onClose={onClose}>
      {lineKey && (
        <div data-testid="safe-detail">
          <p data-testid="safe-detail-rule">
            <strong>{`${d.rule}: `}</strong>
            {r.safeRules[lineKey] ?? ''}
          </p>
          {error === 'offline' && <BigAlert tone="warn" word={r.needsNet} sound={false} />}
          {error === 'failed' && <BigAlert tone="danger" word={r.failed} sound={false} />}
          {!detail && !error && <Skeleton />}
          {detail && (
            <>
              <p data-testid="safe-detail-summary">
                {`${d.count}: ${detail.count} · ${d.amount}: ${formatMoney(detail.total)}`}
              </p>
              {rows.length === 0 ? (
                <p>{r.none}</p>
              ) : (
                <DataTable
                  label={lineName(lineKey)}
                  rows={rows}
                  columns={columns}
                  rowKey={(x) => String(x.i)}
                />
              )}
              {detail.rows.length < detail.count && (
                <ActionButton
                  label={`${d.more} (${detail.rows.length} ${d.of} ${detail.count})`}
                  variant="soft"
                  loading={busy}
                  onClick={() => void more()}
                  testId="safe-detail-more"
                />
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
