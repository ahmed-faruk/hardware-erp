import { useRegisterSW } from 'virtual:pwa-register/react';

import { strings } from '../strings.ar';

import { ActionButton } from './ActionButton';

import styles from './UpdateBanner.module.css';

/** A new version is waiting. It only reloads when the user taps the button, never by itself (CI skill §3). */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className={styles.banner} role="status">
      <span>{strings.update.available}</span>
      <ActionButton label={strings.update.reload} onClick={() => void updateServiceWorker(true)} />
    </div>
  );
}
