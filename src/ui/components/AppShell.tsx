import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { strings } from '../strings.ar';
import { cx } from '../cx';

import styles from './AppShell.module.css';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface AppShellProps {
  nav: NavItem[];
  current: string;
  onNavigate: (path: string) => void;
  status: ReactNode;
  workerName: string;
  onLock: () => void;
  banner?: ReactNode;
  children: ReactNode;
}

/** Side rail from 900 px, bottom tabs below (docs/DESIGN_SYSTEM.md §8). Logical properties only, so RTL needs no overrides. */
export function AppShell({
  nav,
  current,
  onNavigate,
  status,
  workerName,
  onLock,
  banner,
  children,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <h1 className={styles.title}>{strings.appName}</h1>
        {status}
        <button
          type="button"
          className={styles.lock}
          onClick={onLock}
          aria-label={strings.login.lock}
          data-testid="lock"
        >
          <Lock size={20} aria-hidden="true" />
          <span className={styles.who}>{workerName}</span>
        </button>
      </header>
      {banner}
      <nav className={styles.nav} aria-label={strings.appName}>
        {nav.map((item) => (
          <button
            key={item.path}
            type="button"
            className={cx(styles.item, item.path === current && styles.current)}
            aria-current={item.path === current ? 'page' : undefined}
            onClick={() => onNavigate(item.path)}
          >
            <item.icon size={24} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
