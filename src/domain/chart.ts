export interface Scale {
  top: number;
  step: number;
  /** from 0 to top, evenly spaced */
  ticks: number[];
}

/** An axis that ends on a round number: the step is 1, 2, 2.5 or 5 times a power of ten, four steps in all. */
export function niceScale(max: number, steps = 4): Scale {
  if (!(max > 0)) return { top: steps, step: 1, ticks: Array.from({ length: steps + 1 }, (_, i) => i) };
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const mult = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  const step = mult * pow;
  return { top: step * steps, step, ticks: Array.from({ length: steps + 1 }, (_, i) => step * i) };
}
