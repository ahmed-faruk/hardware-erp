const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Converts the top-level keys of a row. Values (including free-form JSON columns) are never touched. */
export function convertRow(row: Record<string, unknown>, to: 'snake' | 'camel'): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [to === 'snake' ? toSnake(key) : toCamel(key), value]),
  );
}
