const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const cairoDay = (d: Date): number => {
  const [y = 0, m = 1, day = 1] = DAY_FORMAT.format(d).split('-').map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
};

/** Whole Cairo calendar days between two instants (the server counts the same way). */
export const cairoDaysBetween = (fromIso: string, toIso: string): number =>
  cairoDay(new Date(toIso)) - cairoDay(new Date(fromIso));

/** RET-02: a return inside the period needs no approval; day `days` still counts as inside. */
export const isWithinReturnPeriod = (issuedAt: string, now: string, days: number): boolean =>
  cairoDaysBetween(issuedAt, now) <= days;
