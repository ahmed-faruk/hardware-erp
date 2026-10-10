import type { Piasters } from './money';

/**
 * Clip keys that say an amount in Egyptian Arabic (skill pos-ui-low-literacy §5). Pure: the player maps keys to audio files.
 * Units 0-19 `n0..n19`, tens `t20..t90`, hundreds `h100..h900`, `thousand`, `two_thousand`, construct forms `c3..c10` + `thousands`,
 * `and`, `egp`, `piaster`, and the lead words `total` and `change`.
 */
const MAX_POUNDS = 999_999;

function below1000(n: number): string[] {
  const out: string[] = [];
  const hundreds = Math.floor(n / 100);
  if (hundreds > 0) out.push(`h${hundreds * 100}`);
  const rest = n % 100;
  if (rest > 0) {
    if (hundreds > 0) out.push('and');
    if (rest < 20) out.push(`n${rest}`);
    else {
      const units = rest % 10;
      if (units > 0) out.push(`n${units}`, 'and');
      out.push(`t${rest - units}`);
    }
  }
  return out;
}

function number(n: number): string[] {
  if (n < 1000) return n === 0 ? ['n0'] : below1000(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head =
    thousands === 1
      ? ['thousand']
      : thousands === 2
        ? ['two_thousand']
        : thousands <= 10
          ? [`c${thousands}`, 'thousands']
          : [...below1000(thousands), 'thousand'];
  return rest > 0 ? [...head, 'and', ...below1000(rest)] : head;
}

export function speakAmount(piasters: Piasters): string[] {
  if (!Number.isInteger(piasters) || piasters < 0) return [];
  const pounds = Math.floor(piasters / 100);
  const rest = piasters % 100;
  if (pounds > MAX_POUNDS) return [];
  const out: string[] = [];
  if (pounds > 0 || rest === 0) out.push(...number(pounds), 'egp');
  if (rest > 0) {
    if (out.length > 0) out.push('and');
    out.push(...below1000(rest), 'piaster');
  }
  return out;
}

export const speakTotal = (piasters: Piasters): string[] => [
  ...(speakAmount(piasters).length ? ['total'] : []),
  ...speakAmount(piasters),
];
export const speakChange = (piasters: Piasters): string[] => [
  ...(speakAmount(piasters).length ? ['change'] : []),
  ...speakAmount(piasters),
];
