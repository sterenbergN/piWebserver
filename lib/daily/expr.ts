// A small, safe math expression evaluator (no eval): lets answers be typed as
// "sqrt(2)" or "3pi/4" instead of 1.41 or 2.36, and drives the calculator.

export type AngleMode = 'rad' | 'deg';
export type EvalResult = { value: number } | { error: string };

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const FUNCS: Record<string, (deg: boolean) => (...a: number[]) => number> = {
  sqrt: () => Math.sqrt,
  cbrt: () => Math.cbrt,
  abs: () => Math.abs,
  exp: () => Math.exp,
  ln: () => Math.log,
  log: () => (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
  log10: () => Math.log10,
  log2: () => Math.log2,
  sin: (deg) => (x) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (deg) => (x) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (deg) => (x) => Math.tan(deg ? (x * Math.PI) / 180 : x),
  asin: (deg) => (x) => Math.asin(x) * (deg ? 180 / Math.PI : 1),
  acos: (deg) => (x) => Math.acos(x) * (deg ? 180 / Math.PI : 1),
  atan: (deg) => (x) => Math.atan(x) * (deg ? 180 / Math.PI : 1),
  atan2: (deg) => (y, x) => Math.atan2(y, x) * (deg ? 180 / Math.PI : 1),
  sinh: () => Math.sinh,
  cosh: () => Math.cosh,
  tanh: () => Math.tanh,
};
const ALIAS: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', root: 'sqrt' };
const ARITY: Record<string, [number, number]> = { log: [1, 2], atan2: [2, 2] };
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Typographic symbols people paste or type on a phone, as plain ASCII. */
function normalize(text: string) {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/√/g, ' sqrt ')
    .replace(/∛/g, ' cbrt ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^');
}

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  const src = normalize(text);
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(rest);
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z]+\d*/i.exec(rest);
    if (id) { tokens.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/^(),°'.includes(src[i])) { tokens.push({ t: 'op', v: src[i] }); i++; continue; }
    return `Unexpected “${src[i]}”`;
  }
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private tokens: Token[], private deg: boolean, private vars: Record<string, number>) {}

  private peek() { return this.tokens[this.i]; }
  private isOp(v: string) { const p = this.peek(); return p?.t === 'op' && p.v === v; }
  private expect(v: string) {
    if (!this.isOp(v)) throw new Error(`Expected “${v}”`);
    this.i++;
  }

  parse() {
    if (!this.tokens.length) throw new Error('Empty');
    const v = this.expr();
    if (this.i < this.tokens.length) throw new Error('Unexpected input');
    return v;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.i++] as { v: string }).v;
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  /** Something that can follow a value with no operator: 2pi, 3(4), 2sqrt(3). */
  private startsFactor() {
    const p = this.peek();
    return !!p && (p.t === 'num' || p.t === 'id' || (p.t === 'op' && p.v === '('));
  }

  private term(): number {
    let v = this.implicit();
    for (;;) {
      if (this.isOp('*')) { this.i++; v *= this.implicit(); }
      else if (this.isOp('/')) { this.i++; v /= this.implicit(); }
      else return v;
    }
  }

  /** Implied multiplication binds tighter than / (as on a scientific calculator): 1/2pi = 1/(2π). */
  private implicit(): number {
    let v = this.unary();
    while (this.startsFactor()) v *= this.power();
    return v;
  }

  private unary(): number {
    if (this.isOp('-')) { this.i++; return -this.unary(); }
    if (this.isOp('+')) { this.i++; return this.unary(); }
    return this.power();
  }

  /** Right-associative, and binds tighter than a leading minus: -2^2 = -4, 2^3^2 = 512. */
  private power(): number {
    const base = this.postfix();
    if (this.isOp('^')) { this.i++; return base ** this.unary(); }
    return base;
  }

  private postfix(): number {
    let v = this.primary();
    while (this.isOp('°')) { this.i++; v = (v * Math.PI) / 180; }
    return v;
  }

  private primary(): number {
    const tok = this.peek();
    if (!tok) throw new Error('Incomplete');
    this.i++;
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'op') {
      if (tok.v !== '(') throw new Error(`Unexpected “${tok.v}”`);
      const v = this.expr();
      this.expect(')');
      return v;
    }
    const name = ALIAS[tok.v] ?? tok.v;
    if (name in this.vars) return this.vars[name];
    if (name in CONSTS) return CONSTS[name];
    const make = FUNCS[name];
    if (!make) throw new Error(`Unknown “${tok.v}”`);
    const fn = make(this.deg);
    const [min, max] = ARITY[name] ?? [1, 1];
    // sqrt(2), or without brackets for one argument: sqrt 2, √2, sin 30°.
    if (!this.isOp('(')) {
      if (min > 1) throw new Error(`${name} needs brackets`);
      return fn(this.postfix());
    }
    this.i++;
    const args = [this.expr()];
    while (this.isOp(',')) { this.i++; args.push(this.expr()); }
    this.expect(')');
    if (args.length < min || args.length > max) throw new Error(`Wrong number of inputs to ${name}`);
    return fn(...args);
  }
}

/** Work out an expression like "sqrt(2)", "3pi/4", "1.2e3", "sin(30°)". Trig is in radians unless `angle` is 'deg'. */
export function evaluate(text: string, opts: { angle?: AngleMode; vars?: Record<string, number> } = {}): EvalResult {
  const tokens = tokenize(text);
  if (typeof tokens === 'string') return { error: tokens };
  try {
    const value = new Parser(tokens, opts.angle === 'deg', opts.vars ?? {}).parse();
    return Number.isFinite(value) ? { value } : { error: 'Not a finite number' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The value of an expression, or null if it isn't one. */
export function evaluateValue(text: string | undefined): number | null {
  if (!text?.trim()) return null;
  const r = evaluate(text);
  return 'value' in r ? r.value : null;
}
