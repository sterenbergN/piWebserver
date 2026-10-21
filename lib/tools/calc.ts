// Math for the calculators page: a safe expression evaluator (no eval),
// loan payments, Ohm's law and price per unit. Kept free of React so it can
// be tested.

export class ExprError extends Error {}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const FUNCS: Record<string, (x: number, deg: boolean) => number> = {
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  sin: (x, deg) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (x, deg) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (x, deg) => Math.tan(deg ? (x * Math.PI) / 180 : x),
  asin: (x, deg) => (deg ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)),
  acos: (x, deg) => (deg ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)),
  atan: (x, deg) => (deg ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
};
export const FUNCTION_NAMES = Object.keys(FUNCS);

function tokenize(src: string): Token[] {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/,/g, '');
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/^()%!√'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new ExprError(`Unexpected “${ch}”`);
  }
  return out;
}

/**
 * Evaluate a calculator expression: + − × ÷ ^, parentheses, % (of 100), !,
 * √, functions (sqrt, sin, log, ln…), pi, e, `ans`, and implied
 * multiplication ("2pi", "3(4+1)"). Trig works in degrees unless `deg` is false.
 */
export function evaluate(src: string, { deg = true, ans = 0 }: { deg?: boolean; ans?: number } = {}): number {
  const tokens = tokenize(src);
  if (!tokens.length) throw new ExprError('Type something to work out');
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const startsValue = () => { const p = peek(); return !!p && (p.t === 'num' || p.t === 'id' || (p.t === 'op' && (p.v === '(' || p.v === '√'))); };

  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) v = tokens[pos++].v === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      if (isOp('*')) { pos++; v *= unary(); }
      else if (isOp('/')) { pos++; const d = unary(); if (d === 0) throw new ExprError('Can’t divide by zero'); v /= d; }
      else if (startsValue()) v *= unary(); // implied: 2pi, 3(4)
      else return v;
    }
  };
  const unary = (): number => {
    if (isOp('-')) { pos++; return -unary(); }
    if (isOp('+')) { pos++; return unary(); }
    return power();
  };
  const power = (): number => {
    const base = postfix();
    if (isOp('^')) { pos++; return base ** unary(); } // right-associative; -2^2 is -(2^2)
    return base;
  };
  const postfix = (): number => {
    let v = primary();
    for (;;) {
      if (isOp('%')) { pos++; v /= 100; }
      else if (isOp('!')) {
        pos++;
        if (!Number.isInteger(v) || v < 0 || v > 170) throw new ExprError('! needs a whole number up to 170');
        let f = 1;
        for (let k = 2; k <= v; k++) f *= k;
        v = f;
      } else return v;
    }
  };
  const primary = (): number => {
    const tok = tokens[pos++];
    if (!tok) throw new ExprError('Unfinished expression');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'op' && tok.v === '(') {
      const v = expr();
      if (isOp(')')) pos++; // a missing closing bracket is forgiven, like a phone calculator
      return v;
    }
    if (tok.t === 'op' && tok.v === '√') return Math.sqrt(postfix());
    if (tok.t === 'id') {
      if (tok.v === 'pi') return Math.PI;
      if (tok.v === 'e') return Math.E;
      if (tok.v === 'ans') return ans;
      const fn = FUNCS[tok.v];
      if (!fn) throw new ExprError(`Unknown “${tok.v}”`);
      return fn(postfix(), deg);
    }
    throw new ExprError(`Unexpected “${tok.v}”`);
  };

  const value = expr();
  if (pos < tokens.length) throw new ExprError(`Unexpected “${(tokens[pos] as Token).v}”`);
  if (!Number.isFinite(value)) throw new ExprError('That doesn’t give a number');
  return value;
}

/** Monthly payment, and the totals, for a fixed-rate loan (with optional extra each month). */
export function loan(principal: number, aprPercent: number, years: number, extra = 0) {
  const n = Math.round(years * 12);
  const r = aprPercent / 100 / 12;
  if (!(principal > 0) || !(n > 0) || aprPercent < 0) return null;
  const payment = r ? (principal * r) / (1 - (1 + r) ** -n) : principal / n;
  const run = (add: number) => {
    let balance = principal;
    let months = 0;
    let interest = 0;
    const yearly: { year: number; interest: number; principal: number; balance: number }[] = [];
    while (balance > 0.005 && months < n) {
      const i = balance * r;
      const paid = Math.min(balance, payment + add - i);
      balance -= paid;
      interest += i;
      months++;
      const y = Math.ceil(months / 12);
      const row = yearly[y - 1] ||= { year: y, interest: 0, principal: 0, balance: 0 };
      row.interest += i;
      row.principal += paid;
      row.balance = Math.max(0, balance);
    }
    return { months, interest, total: principal + interest, yearly };
  };
  const base = run(0);
  const withExtra = extra > 0 ? run(extra) : null;
  return {
    payment,
    ...base,
    extra: withExtra && { months: withExtra.months, interest: withExtra.interest, monthsSaved: base.months - withExtra.months, interestSaved: base.interest - withExtra.interest },
  };
}

export type OhmValues = { v?: number; i?: number; r?: number; p?: number };

/** Any two of volts, amps, ohms and watts → all four (null if fewer than two are given). */
export function ohms(given: OhmValues): Required<OhmValues> | null {
  const has = (k: keyof OhmValues) => typeof given[k] === 'number' && Number.isFinite(given[k]);
  const { v, i, r, p } = given as Required<OhmValues>;
  if (has('v') && has('i')) return { v, i, r: v / i, p: v * i };
  if (has('v') && has('r')) return { v, i: v / r, r, p: (v * v) / r };
  if (has('v') && has('p')) return { v, i: p / v, r: (v * v) / p, p };
  if (has('i') && has('r')) return { v: i * r, i, r, p: i * i * r };
  if (has('i') && has('p')) return { v: p / i, i, r: p / (i * i), p };
  if (has('r') && has('p')) { const cur = Math.sqrt(p / r); return { v: cur * r, i: cur, r, p }; }
  return null;
}

/** Price per unit for each item, and which index is cheapest (ties: the first). */
export function unitPrices(items: { price: number | null; size: number | null }[]) {
  const per = items.map((x) => (x.price !== null && x.size ? x.price / x.size : null));
  let best = -1;
  per.forEach((v, idx) => { if (v !== null && (best < 0 || v < per[best]!)) best = idx; });
  return { per, best };
}
