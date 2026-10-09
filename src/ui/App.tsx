import { strings } from '@/ui/strings.ar';

import styles from './App.module.css';

export function App() {
  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.title}>{strings.appName}</h1>
        <p className={styles.status} data-testid="status">
          {strings.homeReady}
        </p>
      </div>
    </main>
  );
}
