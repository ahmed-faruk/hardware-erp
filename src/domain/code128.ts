/** Code 128 B as pure data (no library). Patterns are bar/space widths in modules, symbol values 0-105, then the stop symbol. */
export const PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

const START_B = 104;
const STOP = 106;

export interface Bar {
  black: boolean;
  width: number;
}

export interface Code128 {
  symbols: number[];
  bars: Bar[];
  modules: number;
}

/** Encodes printable ASCII (space to `~`), with start B, checksum modulo 103 and stop. */
export function code128B(text: string): Code128 {
  const values = [...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new RangeError(`Code 128 B cannot encode "${ch}"`);
    return code - 32;
  });
  const checksum = (START_B + values.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  const symbols = [START_B, ...values, checksum, STOP];
  const bars: Bar[] = [];
  for (const s of symbols) {
    [...(PATTERNS[s] as string)].forEach((digit, i) =>
      bars.push({ black: i % 2 === 0, width: Number(digit) }),
    );
  }
  return { symbols, bars, modules: bars.reduce((sum, b) => sum + b.width, 0) };
}
