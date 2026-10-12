/** Today (or a day offset from `base`) as the shop's Cairo calendar day, yyyy-mm-dd. */
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
export const cairoDay = (offsetDays = 0, base = new Date()): string =>
  DAY_FORMAT.format(new Date(base.getTime() + offsetDays * 86_400_000));

export const monthStart = (day: string): string => `${day.slice(0, 8)}01`;
