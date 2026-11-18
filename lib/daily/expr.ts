// A small, safe math expression evaluator (no eval): lets answers be typed as
// "sqrt(2)" or "3pi/4" instead of 1.41 or 2.36, and drives the calculator.

export type AngleMode = 'rad' | 'deg';
export type CalcDisplayMode = 'dec' | 'frac' | 'sci' | 'eng';
export type EvalResult = { value: number } | { error: string };

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

type Val = { v: number; inRad?: boolean };
const num = (v: number): Val => ({ v });
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const angleVal = (deg: boolean, x: Val) => (deg && !x.inRad ? (x.v * Math.PI) / 180 : x.v);
const invScale = (deg: boolean) => (deg ? 180 / Math.PI : 1);

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error('Factorial needs a whole number');
  if (n > 170) throw new Error('Too big');
  let res = 1;
  for (let k = 2; k <= n; k++) res *= k;
  return res;
}

function positiveMod(a: number, b: number): number {
  const r = a % b;
  return r === 0 ? 0 : r * b < 0 ? r + b : r;
}

function gcdInt(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('gcd needs whole numbers');
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function lcmInt(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('lcm needs whole numbers');
  if (a === 0 || b === 0) return 0;
  return Math.abs((a / gcdInt(a, b)) * b);
}

function combinations(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0) {
    throw new Error('ncr needs whole numbers');
  }
  if (r > n) return 0;
  const k = Math.min(r, n - r);
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
  return Math.round(res);
}

function permutations(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0) {
    throw new Error('npr needs whole numbers');
  }
  if (r > n) return 0;
  let res = 1;
  for (let i = 0; i < r; i++) res *= n - i;
  return res;
}

const FUNCS: Record<string, (deg: boolean) => (...a: Val[]) => Val> = {
  sqrt: () => (x) => num(Math.sqrt(x.v)),
  cbrt: () => (x) => num(Math.cbrt(x.v)),
  abs: () => (x) => num(Math.abs(x.v)),
  exp: () => (x) => num(Math.exp(x.v)),
  ln: () => (x) => num(Math.log(x.v)),
  log: () => (x, base) => num(base === undefined ? Math.log10(x.v) : Math.log(x.v) / Math.log(base.v)),
  log10: () => (x) => num(Math.log10(x.v)),
  log2: () => (x) => num(Math.log2(x.v)),
  sin: (deg) => (x) => num(Math.sin(angleVal(deg, x))),
  cos: (deg) => (x) => num(Math.cos(angleVal(deg, x))),
  tan: (deg) => (x) => num(Math.tan(angleVal(deg, x))),
  sec: (deg) => (x) => num(1 / Math.cos(angleVal(deg, x))),
  csc: (deg) => (x) => num(1 / Math.sin(angleVal(deg, x))),
  cot: (deg) => (x) => num(1 / Math.tan(angleVal(deg, x))),
  asin: (deg) => (x) => num(Math.asin(x.v) * invScale(deg)),
  acos: (deg) => (x) => num(Math.acos(x.v) * invScale(deg)),
  atan: (deg) => (x) => num(Math.atan(x.v) * invScale(deg)),
  asec: (deg) => (x) => num(Math.acos(1 / x.v) * invScale(deg)),
  acsc: (deg) => (x) => num(Math.asin(1 / x.v) * invScale(deg)),
  acot: (deg) => (x) => num((x.v === 0 ? Math.PI / 2 : Math.atan(1 / x.v)) * invScale(deg)),
  atan2: (deg) => (y, x) => num(Math.atan2(y.v, x.v) * invScale(deg)),
  sinh: () => (x) => num(Math.sinh(x.v)),
  cosh: () => (x) => num(Math.cosh(x.v)),
  tanh: () => (x) => num(Math.tanh(x.v)),
  asinh: () => (x) => num(Math.asinh(x.v)),
  acosh: () => (x) => num(Math.acosh(x.v)),
  atanh: () => (x) => num(Math.atanh(x.v)),
  floor: () => (x) => num(Math.floor(x.v)),
  ceil: () => (x) => num(Math.ceil(x.v)),
  round: () => (x) => num(Math.round(x.v)),
  sign: () => (x) => num(Math.sign(x.v)),
  mod: () => (a, b) => num(positiveMod(a.v, b.v)),
  gcd: () => (a, b) => num(gcdInt(a.v, b.v)),
  lcm: () => (a, b) => num(lcmInt(a.v, b.v)),
  ncr: () => (n, r) => num(combinations(n.v, r.v)),
  npr: () => (n, r) => num(permutations(n.v, r.v)),
  hypot: () => (...args) => num(Math.hypot(...args.map((a) => a.v))),
  parallel: () => (...args) => {
    const res = 1 / args.reduce((sum, a) => sum + 1 / a.v, 0);
    return num(res === 0 ? 0 : res);
  },
  db: () => (x) => num(20 * Math.log10(x.v)),
  db10: () => (x) => num(10 * Math.log10(x.v)),
};
const ALIAS: Record<string, string> = {
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arcsec: 'asec',
  arccsc: 'acsc',
  arccot: 'acot',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  root: 'sqrt',
};
const ARITY: Record<string, [number, number]> = {
  log: [1, 2],
  atan2: [2, 2],
  mod: [2, 2],
  gcd: [2, 2],
  lcm: [2, 2],
  ncr: [2, 2],
  npr: [2, 2],
  hypot: [2, 8],
  parallel: [2, 8],
};
const CONSTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  g: 9.80665,
  c: 299792458,
  na: 6.02214076e23,
  kb: 1.380649e-23,
  qe: 1.602176634e-19,
  rgas: 8.314462618,
};
const KNOWN_IDS = new Set([
  'deg',
  'degrees',
  ...Object.keys(FUNCS),
  ...Object.keys(ALIAS),
  ...Object.keys(CONSTS),
]);

/** Typographic symbols people paste or type on a phone, as plain ASCII. */
function normalize(text: string) {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/φ/g, ' phi ')
    .replace(/√/g, ' sqrt ')
    .replace(/∛/g, ' cbrt ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^');
}

function tokenize(text: string, vars?: Record<string, number>): Token[] | string {
  const tokens: Token[] = [];
  const src = normalize(text);
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(rest);
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^([a-z]+)(\d*)/i.exec(rest);
    if (id) {
      const raw = id[0].toLowerCase();
      const letters = id[1].toLowerCase();
      if (!id[2] || KNOWN_IDS.has(raw) || (vars && hasOwn(vars, raw))) {
        tokens.push({ t: 'id', v: raw });
        i += id[0].length;
      } else if (KNOWN_IDS.has(letters) || (vars && hasOwn(vars, letters))) {
        tokens.push({ t: 'id', v: letters });
        i += id[1].length;
      } else {
        tokens.push({ t: 'id', v: raw });
        i += id[0].length;
      }
      continue;
    }
    if ('*/+-^(),°!%'.includes(src[i])) { tokens.push({ t: 'op', v: src[i] }); i++; continue; }
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

  parse(): number {
    if (!this.tokens.length) throw new Error('Empty');
    const val = this.expr();
    if (this.i < this.tokens.length) throw new Error('Unexpected input');
    return val.v;
  }

  private expr(): Val {
    let val = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.i++] as { v: string }).v;
      const r = this.term();
      val = {
        v: op === '+' ? val.v + r.v : val.v - r.v,
        ...(val.inRad && r.inRad ? { inRad: true } : {}),
      };
    }
    return val;
  }

  /** Something that can follow a value with no operator: 2pi, 3(4), 2sqrt(3). */
  private startsFactor() {
    const p = this.peek();
    return !!p && (p.t === 'num' || p.t === 'id' || (p.t === 'op' && p.v === '('));
  }

  private term(): Val {
    let val = this.implicit();
    for (;;) {
      if (this.isOp('*')) {
        this.i++;
        const r = this.implicit();
        val = { v: val.v * r.v, ...(Boolean(val.inRad) !== Boolean(r.inRad) ? { inRad: true } : {}) };
      } else if (this.isOp('/')) {
        this.i++;
        const r = this.implicit();
        val = { v: val.v / r.v, ...(val.inRad && !r.inRad ? { inRad: true } : {}) };
      } else return val;
    }
  }

  /** Implied multiplication binds tighter than / (as on a scientific calculator): 1/2pi = 1/(2π). */
  private implicit(): Val {
    let val = this.unary();
    while (this.startsFactor()) {
      const r = this.power();
      val = { v: val.v * r.v, ...(Boolean(val.inRad) !== Boolean(r.inRad) ? { inRad: true } : {}) };
    }
    return val;
  }

  private unary(): Val {
    if (this.isOp('-')) {
      this.i++;
      const a = this.unary();
      return { v: -a.v, ...(a.inRad ? { inRad: true } : {}) };
    }
    if (this.isOp('+')) { this.i++; return this.unary(); }
    return this.power();
  }

  /** Right-associative, and binds tighter than a leading minus: -2^2 = -4, 2^3^2 = 512. */
  private power(): Val {
    const base = this.postfix();
    if (this.isOp('^')) { this.i++; return num(base.v ** this.unary().v); }
    return base;
  }

  /** Degrees: 30° or 30deg (for keyboards without a ° key). */
  private isDeg() {
    const p = this.peek();
    return !!p && ((p.t === 'op' && p.v === '°') || (p.t === 'id' && (p.v === 'deg' || p.v === 'degrees')));
  }

  private postfix(): Val {
    let val = this.primary();
    for (;;) {
      if (this.isDeg()) {
        this.i++;
        val = { v: (val.v * Math.PI) / 180, inRad: true };
      } else if (this.isOp('!')) {
        this.i++;
        val = num(factorial(val.v));
      } else if (this.isOp('%')) {
        this.i++;
        val = num(val.v / 100);
      } else {
        return val;
      }
    }
  }

  private primary(): Val {
    const tok = this.peek();
    if (!tok) throw new Error('Incomplete');
    this.i++;
    if (tok.t === 'num') return num(tok.v);
    if (tok.t === 'op') {
      if (tok.v !== '(') throw new Error(`Unexpected “${tok.v}”`);
      const val = this.expr();
      this.expect(')');
      return val;
    }
    const name = hasOwn(ALIAS, tok.v) ? ALIAS[tok.v] : tok.v;
    if (hasOwn(this.vars, name)) return num(this.vars[name]);
    if (hasOwn(CONSTS, name)) return num(CONSTS[name]);
    const make = hasOwn(FUNCS, name) ? FUNCS[name] : undefined;
    if (!make) throw new Error(`Unknown “${tok.v}”`);
    const fn = make(this.deg);
    const [min, max] = hasOwn(ARITY, name) ? ARITY[name] : [1, 1];
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

/** Work out an expression like "sqrt(2)", "3pi/4", "1.2e3", "sin(30deg)". Trig is in radians unless `angle` is 'deg'. */
export function evaluate(text: string, opts: { angle?: AngleMode; vars?: Record<string, number> } = {}): EvalResult {
  const vars: Record<string, number> = {};
  if (opts.vars) {
    for (const [k, v] of Object.entries(opts.vars)) vars[k.toLowerCase()] = v;
  }
  const tokens = tokenize(text, vars);
  if (typeof tokens === 'string') return { error: tokens };
  try {
    const value = new Parser(tokens, opts.angle === 'deg', vars).parse();
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

const SUPERSCRIPTS: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

const SI_PREFIX: Record<number, string> = {
  12: 'T',
  9: 'G',
  6: 'M',
  3: 'k',
  [-3]: 'm',
  [-6]: 'µ',
  [-9]: 'n',
  [-12]: 'p',
};

function toSuperscript(exp: number): string {
  return String(exp)
    .split('')
    .map((ch) => SUPERSCRIPTS[ch] ?? ch)
    .join('');
}

function parseExp(v: number): { sign: string; digits: string; exp10: number } | null {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(v.toExponential(9));
  if (!m) return null;
  return { sign: m[1], digits: `${m[2]}${m[3] ?? ''}`, exp10: Number(m[4]) };
}

function toFraction(x: number, maxDen = 10000, tol = 1e-9): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return [0, 1];
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax > 1e12) return null;
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = ax;
  const bound = Math.max(tol, 1e-12 * ax);
  for (let iter = 0; iter < 64; iter++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (h1 !== 0 && Math.abs(ax - h1 / k1) <= bound) {
      return [sign * h1, k1];
    }
    const rem = b - a;
    if (rem < 1e-12) break;
    b = 1 / rem;
  }
  return null;
}

/** Format a numeric calculator result in decimal, fraction (including rational π multiples), scientific, or engineering mode. */
export function formatCalcValue(n: number, mode: CalcDisplayMode = 'dec'): string {
  if (!Number.isFinite(n)) return 'Error';
  const v = n === 0 ? 0 : n;
  if (mode === 'dec') {
    const rounded = +v.toPrecision(10);
    return Number.isFinite(rounded) ? String(rounded) : v.toPrecision(10);
  }
  if (mode === 'sci') {
    if (v === 0) return '0';
    const exp = parseExp(v);
    if (!exp) return formatCalcValue(v, 'dec');
    const frac = exp.digits.slice(1).replace(/0+$/, '');
    const mantissa = frac ? `${exp.digits[0]}.${frac}` : exp.digits[0];
    return `${exp.sign}${mantissa}×10${toSuperscript(exp.exp10)}`;
  }
  if (mode === 'eng') {
    if (v === 0) return '0';
    const exp = parseExp(v);
    if (!exp) return formatCalcValue(v, 'dec');
    const engExp = Math.floor(exp.exp10 / 3) * 3;
    const shift = exp.exp10 - engExp;
    const intPart = exp.digits.slice(0, 1 + shift);
    const fracPart = exp.digits.slice(1 + shift).replace(/0+$/, '');
    const mantissa = fracPart ? `${intPart}.${fracPart}` : intPart;
    const prefix = SI_PREFIX[engExp];
    return `${exp.sign}${mantissa}×10${toSuperscript(engExp)}${prefix ? ` (${prefix})` : ''}`;
  }
  if (v === 0) return '0';
  const frac = toFraction(v);
  if (frac) {
    const [num, den] = frac;
    return den === 1 ? String(num) : `${num}/${den}`;
  }
  const piFrac = toFraction(v / Math.PI);
  if (piFrac) {
    const [num, den] = piFrac;
    const sign = num < 0 ? '-' : '';
    const absNum = Math.abs(num);
    const coef = absNum === 1 ? '' : String(absNum);
    return den === 1 ? `${sign}${coef}π` : `${sign}${coef}π/${den}`;
  }
  return formatCalcValue(v, 'dec');
}
