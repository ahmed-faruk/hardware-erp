import styles from './Skeleton.module.css';

/** Loading placeholder the size of the content it replaces. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.wrap} role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row} />
      ))}
    </div>
  );
}
