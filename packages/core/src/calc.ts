import { ValidationError } from './errors.ts';

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string };

function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const clean = text.replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  let i = 0;
  while (i < clean.length) {
    const ch = clean.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (/[\d.]/.test(ch)) {
      let j = i;
      while (j < clean.length && /[\d.]/.test(clean.charAt(j))) j++;
      const literal = clean.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(literal))
        throw new ValidationError(`"${literal}" is not a number.`);
      tokens.push({ kind: 'num', value: Number(literal) });
      i = j;
    } else if ('+-*/()%'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
    } else {
      throw new ValidationError(`The calculator does not understand "${ch}".`);
    }
  }
  return tokens;
}

/**
 * A small calculator for quick sums at the counter: + - * / ( ) and "%" after a number
 * (50% is 0.5). It is a scratch pad only; nothing it produces is ever saved to the books, so it
 * works in ordinary decimals. The result is rounded to 4 decimal places.
 */
export function calculate(text: string): number {
  const tokens = tokenise(text);
  if (tokens.length === 0) throw new ValidationError('Please type a sum, for example 450*12+30.');
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, v: string) => t?.kind === 'op' && t.value === v;

  const primary = (): number => {
    const t = tokens[pos++];
    if (!t) throw new ValidationError('The sum is not finished.');
    if (t.kind === 'num') {
      let value = t.value;
      while (isOp(peek(), '%')) {
        pos++;
        value /= 100;
      }
      return value;
    }
    if (t.value === '-') return -primary();
    if (t.value === '+') return primary();
    if (t.value === '(') {
      const inner = sum();
      if (!isOp(tokens[pos++], ')')) throw new ValidationError('A bracket is not closed.');
      return inner;
    }
    throw new ValidationError('The sum does not look right.');
  };
  const product = (): number => {
    let value = primary();
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = primary();
      if (op === '/' && right === 0) throw new ValidationError('You cannot divide by zero.');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = sum();
  if (pos < tokens.length) throw new ValidationError('The sum does not look right.');
  if (!Number.isFinite(result)) throw new ValidationError('That number is too big.');
  return Math.round(result * 10_000) / 10_000;
}
