import { describe, expect, it } from 'vitest';

import { strings } from '../strings.ar';

import { CATALOG, GENERIC_ICON_KEY, iconFor, searchIcons } from './catalog';

describe('icon catalog', () => {
  it('has an Arabic name for every icon and no duplicates', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(80);
    const names = CATALOG.map((e) => e.name);
    expect(names.every((n) => /[؀-ۿ]/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(strings.iconItems).sort()).toEqual(CATALOG.map((e) => e.key).sort());
  });
  it('covers the hardware and paint basics, including the hand-drawn ones', () => {
    const keys = new Set(CATALOG.map((e) => e.key));
    for (const k of [
      'paint-roller',
      'paint-bucket',
      'hammer',
      'drill',
      'wrench',
      'screwdriver',
      'saw',
      'pliers',
      'pipe',
      'tape-measure',
      'nails',
      'socket',
      'light-switch',
      'faucet',
      'lightbulb',
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });
  it('falls back to the generic box', () => {
    expect(iconFor(undefined)).toBe(iconFor(GENERIC_ICON_KEY));
    expect(iconFor('no-such-icon')).toBe(iconFor(GENERIC_ICON_KEY));
    expect(iconFor('hammer')).not.toBe(iconFor(GENERIC_ICON_KEY));
  });
  it('searches by Arabic name and by synonym, ignoring alef and ta marbuta variants', () => {
    expect(searchIcons('شاكوش').map((e) => e.key)).toContain('hammer');
    expect(searchIcons('بويه').map((e) => e.key)).toContain('paint-bucket');
    expect(searchIcons('منشار')[0]?.key).toBe('saw');
    expect(searchIcons('')).toHaveLength(CATALOG.length);
    expect(searchIcons('zzzz')).toHaveLength(0);
  });
});
