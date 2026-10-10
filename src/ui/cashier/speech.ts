import { play } from '../sound';

/**
 * Plays the recorded Egyptian-Arabic clips for a list of keys from `speakAmount` (docs/sounds.md lists the files).
 * Missing clips are skipped silently: the shop works without them and gets the voice when the owner adds the files.
 * One AudioContext queue; never uses speechSynthesis (Arabic voices are missing on many PCs, Windows 7 included).
 */
let context: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
let enabled = true;

export const setSpeechEnabled = (value: boolean): void => {
  enabled = value;
};

async function clip(key: string): Promise<AudioBuffer | null> {
  if (buffers.has(key)) return buffers.get(key) ?? null;
  try {
    const res = await fetch(`/sounds/ar/${key}.mp3`);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('audio')) throw new Error('missing');
    context ??= new AudioContext();
    const buffer = await context.decodeAudioData(await res.arrayBuffer());
    buffers.set(key, buffer);
    return buffer;
  } catch {
    buffers.set(key, null);
    return null;
  }
}

export async function speak(keys: string[]): Promise<void> {
  if (!enabled || keys.length === 0 || typeof AudioContext === 'undefined') return;
  const buffersInOrder = await Promise.all(keys.map(clip));
  if (buffersInOrder.some((b) => b === null)) return; // an utterance with a hole in it would be worse than silence
  context ??= new AudioContext();
  let at = context.currentTime;
  for (const buffer of buffersInOrder as AudioBuffer[]) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(at);
    at += buffer.duration;
  }
}

export { play };
