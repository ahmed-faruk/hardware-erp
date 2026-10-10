import { describe, expect, it } from 'vitest';

import { speakAmount, speakChange, speakTotal } from './speak';

const say = (pounds: number, piasters = 0): string => speakAmount(pounds * 100 + piasters).join(' ');

describe('speakAmount (clip keys, skill pos-ui-low-literacy §5)', () => {
  it.each([
    [0, 0, 'n0 egp'],
    [1, 0, 'n1 egp'],
    [2, 0, 'n2 egp'],
    [11, 0, 'n11 egp'],
    [19, 0, 'n19 egp'],
    [20, 0, 't20 egp'],
    [21, 0, 'n1 and t20 egp'],
    [75, 0, 'n5 and t70 egp'],
    [100, 0, 'h100 egp'],
    [101, 0, 'h100 and n1 egp'],
    [111, 0, 'h100 and n11 egp'],
    [120, 0, 'h100 and t20 egp'],
    [275, 0, 'h200 and n5 and t70 egp'],
    [900, 0, 'h900 egp'],
  ])('%i pounds', (pounds, piasters, expected) => expect(say(pounds, piasters)).toBe(expected));

  it.each([
    [1000, 'thousand egp'],
    [1001, 'thousand and n1 egp'],
    [2000, 'two_thousand egp'],
    [3000, 'c3 thousands egp'],
    [10000, 'c10 thousands egp'],
    [11000, 'n11 thousand egp'],
    [21000, 'n1 and t20 thousand egp'],
    [100000, 'h100 thousand egp'],
    [1275, 'thousand and h200 and n5 and t70 egp'],
  ])('thousands: %i', (pounds, expected) => expect(say(pounds)).toBe(expected));

  it('piasters follow the pounds with "and"; piasters alone have no pounds', () => {
    expect(say(1275, 50)).toBe('thousand and h200 and n5 and t70 egp and t50 piaster');
    expect(say(0, 25)).toBe('n5 and t20 piaster');
    expect(say(3, 5)).toBe('n3 egp and n5 piaster');
  });
  it('total and change get their lead word', () => {
    expect(speakTotal(12550)).toEqual([
      'total',
      'h100',
      'and',
      'n5',
      'and',
      't20',
      'egp',
      'and',
      't50',
      'piaster',
    ]);
    expect(speakChange(500)[0]).toBe('change');
  });
  it('nothing is spoken for a negative or huge amount', () => {
    expect(speakAmount(-1)).toEqual([]);
    expect(speakAmount(100_000_000)).toEqual([]);
  });
});
