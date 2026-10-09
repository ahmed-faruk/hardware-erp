/** Interim tones made with Web Audio until the recorded clips exist (docs/DESIGN_SYSTEM.md §5). Works offline, no files. */
type Tone = 'ok' | 'error' | 'done';

const TONES: Record<Tone, [number, number][]> = {
  ok: [[880, 0.07]],
  error: [
    [220, 0.18],
    [165, 0.22],
  ],
  done: [
    [660, 0.08],
    [880, 0.08],
    [1320, 0.14],
  ],
};

let context: AudioContext | null = null;
let enabled = true;

export const setSoundEnabled = (value: boolean): void => {
  enabled = value;
};

export function play(tone: Tone): void {
  if (!enabled || typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    let at = context.currentTime;
    for (const [frequency, seconds] of TONES[tone]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + seconds);
      at += seconds;
    }
  } catch {
    // a browser that blocks audio must never break a screen
  }
}
