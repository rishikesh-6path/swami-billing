import { describe, expect, it } from 'vitest';
import { calculate } from '../src/calc.ts';

describe('calculate', () => {
  it('follows the usual order of working', () => {
    expect(calculate('450*12+30')).toBe(5430);
    expect(calculate('2+3*4')).toBe(14);
    expect(calculate('(2+3)*4')).toBe(20);
    expect(calculate('100/8')).toBe(12.5);
    expect(calculate('-5+10')).toBe(5);
    expect(calculate('1,250.50 + 0.5')).toBe(1251);
  });

  it('handles percentages after a number', () => {
    expect(calculate('2000*18%')).toBe(360);
    expect(calculate('2000+2000*18%')).toBe(2360);
  });

  it('hides binary floating point noise', () => {
    expect(calculate('0.1+0.2')).toBe(0.3);
  });

  it('explains mistakes in plain words', () => {
    expect(() => calculate('')).toThrow(/type a sum/);
    expect(() => calculate('5/0')).toThrow(/divide by zero/);
    expect(() => calculate('(2+3')).toThrow(/bracket/);
    expect(() => calculate('2+')).toThrow(/not finished/);
    expect(() => calculate('2 x 3')).toThrow(/does not understand/);
    expect(() => calculate('1.2.3')).toThrow(/not a number/);
    expect(() => calculate('2 3')).toThrow(/does not look right/);
  });
});
