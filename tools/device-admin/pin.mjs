// PIN hashing for the Mac-side admin tools. Must stay identical to src/db/workers.ts (PBKDF2-SHA256, 210,000 iterations,
// 16-byte random salt, 256-bit result, both base64). tests/int/pin-compat.test.ts proves the two agree.
import { pbkdf2Sync, randomBytes } from 'node:crypto';

export const ITERATIONS = 210_000;

export function hashPin(pin) {
  if (!/^\d{6,12}$/.test(pin)) throw new Error('PIN must be 6 to 12 digits');
  const salt = randomBytes(16);
  return {
    pinHash: pbkdf2Sync(pin, salt, ITERATIONS, 32, 'sha256').toString('base64'),
    pinSalt: salt.toString('base64'),
  };
}

/** Reads a line from the terminal without echoing it. */
export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('The PIN must be typed in an interactive terminal'));
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f') value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on('data', onData);
  });
}
