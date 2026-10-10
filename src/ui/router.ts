import { useSyncExternalStore } from 'react';

/** Tiny hash router: `#/products/42/edit` -> ['products', '42', 'edit']. No dependency, works offline and on file-like hosting. */
export function parseHash(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export const toHash = (segments: string[]): string => `#/${segments.map(encodeURIComponent).join('/')}`;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The current route as one string (stable for useSyncExternalStore). */
const snapshot = (): string => window.location.hash;

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  return parseHash(hash);
}

export function navigate(...segments: string[]): void {
  window.location.hash = toHash(segments);
}
