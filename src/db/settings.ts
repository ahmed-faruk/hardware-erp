import { parseSettings, type Settings } from '@/domain/settings';

import type { HanafyDB } from './schema';

/** Company settings (synced, saved by the manager) merged over the safe defaults. */
export async function loadSettings(db: HanafyDB): Promise<Settings> {
  const rows = (await db.settings.toArray()).filter((r) => !r.deletedAt);
  return parseSettings(rows.map((r) => ({ key: r.key, value: r.value })));
}

const DEVICE_DEFAULTS = {
  paper: '80',
  copies: 1,
  autoPrint: true,
  sounds: true,
  digits: 'latn',
  idleLockMinutes: 10,
} as const;
export type DeviceSettings = {
  paper: '58' | '80';
  copies: number;
  autoPrint: boolean;
  sounds: boolean;
  digits: 'latn' | 'arab';
  /** SEC-03: the screen locks after this many idle minutes */
  idleLockMinutes: number;
};

/** Settings of THIS device only (printer, sounds, digits): never synced. */
export async function loadDeviceSettings(db: HanafyDB): Promise<DeviceSettings> {
  const rows = await db.deviceSettings.bulkGet(Object.keys(DEVICE_DEFAULTS));
  const get = <K extends keyof DeviceSettings>(key: K, i: number): DeviceSettings[K] => {
    const v = rows[i]?.value;
    return (
      v === undefined || typeof v !== typeof DEVICE_DEFAULTS[key] ? DEVICE_DEFAULTS[key] : v
    ) as DeviceSettings[K];
  };
  const keys = Object.keys(DEVICE_DEFAULTS) as (keyof DeviceSettings)[];
  return Object.fromEntries(keys.map((k, i) => [k, get(k, i)])) as DeviceSettings;
}

export const saveDeviceSetting = (
  db: HanafyDB,
  key: keyof DeviceSettings,
  value: string | number | boolean,
): Promise<unknown> => db.deviceSettings.put({ key, value });
