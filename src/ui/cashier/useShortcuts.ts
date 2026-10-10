import { useEffect, useRef } from 'react';

/** Default keys of prd-v2 §16.3. Never F5, Space, Ctrl+W/T/N or Alt+letter (the browser keeps those). */
export type ShortcutName = 'search' | 'customer' | 'hold' | 'held' | 'pay' | 'finish' | 'escape';

export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey'>): ShortcutName | null {
  if (e.ctrlKey && e.key === 'Enter') return 'finish';
  if (e.ctrlKey) return null;
  switch (e.key) {
    case 'F2':
      return 'search';
    case 'F4':
      return 'customer';
    case 'F8':
      return e.shiftKey ? 'held' : 'hold';
    case 'F9':
      return 'pay';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

export function useShortcuts(handlers: Partial<Record<ShortcutName, () => void>>): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const name = shortcutFor(e);
      const fn = name ? ref.current[name] : undefined;
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
