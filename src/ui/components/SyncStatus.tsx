import { RefreshCw, WifiOff } from 'lucide-react';

import { strings } from '../strings.ar';
import { cx } from '../cx';

import styles from './SyncStatus.module.css';

export interface SyncStatusProps {
  online: boolean;
  pending: number;
  lastSyncAt: number | null;
}

const time = (ms: number): string =>
  new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

/** Always visible in the top bar: dot (green online / grey offline / amber pending), pending count, last sync. */
export function SyncStatus({ online, pending, lastSyncAt }: SyncStatusProps) {
  const state = !online ? 'offline' : pending > 0 ? 'pending' : 'online';
  const Icon = online ? RefreshCw : WifiOff;
  return (
    <div className={styles.status} data-state={state} data-testid="sync-status">
      <span className={cx(styles.dot, styles[state])} aria-hidden="true" />
      <Icon size={18} aria-hidden="true" />
      <span className={styles.word}>{online ? strings.sync.online : strings.sync.offline}</span>
      <span data-testid="sync-pending" aria-label={strings.sync.pending}>
        {pending}
      </span>
      <span className={styles.last}>{lastSyncAt ? time(lastSyncAt) : strings.sync.never}</span>
    </div>
  );
}
