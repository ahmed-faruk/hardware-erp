import type { LucideIcon } from 'lucide-react';

import { ActionButton } from './ActionButton';

import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon: LucideIcon;
  word: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, word, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon size={64} aria-hidden="true" />
      <p>{word}</p>
      {action && <ActionButton label={action.label} onClick={action.onClick} />}
    </div>
  );
}
