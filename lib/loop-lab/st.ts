// A small IEC 61131-3 Structured Text interpreter, for controllers written by
// hand. The subset that controller code uses:
//   VAR … END_VAR declarations (REAL, LREAL, INT, DINT, BOOL), with initial values;
//   := assignments; IF / ELSIF / ELSE; FOR … TO … BY … DO; WHILE; REPEAT … UNTIL;
//   EXIT; RETURN; + − * / MOD **, comparisons, AND OR XOR NOT, and the standard
//   functions (ABS, SQRT, EXP, LN, LOG, SIN, COS, TAN, ASIN, ACOS, ATAN, MIN,
//   MAX, LIMIT, SEL, TRUNC, ROUND, and the *_TO_* conversions), with positional
//   or named (IN :=) arguments. Case-insensitive; // (* *) /* */ comments.
// Everything is a number (BOOL is 0/1). Variables declared in VAR keep their
// values from one cycle to the next, like an FB's statics.

export type StType = 'REAL' | 'LREAL' | 'INT' | 'DINT' | 'BOOL';
export type StVar = { name: string; type: StType; init: number; line: number };
/** v is upper case (ST is case-insensitive); raw is as written, for messages. */
type Tok = { k: 'num' | 'id' | 'op' | 'kw' | 'eof'; v: string; raw: string; line: number; pos: number; end: number };

const KEYWORDS = new Set(['VAR', 'VAR_TEMP', 'END_VAR', 'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE', 'REAL', 'LREAL', 'INT', 'DINT', 'BOOL']);

export class StError extends Error {
  constructor(message: string, readonly line: number) { super(message); }
}

/** Tokens with their positions (comments skipped, but their spans kept out of the tokens). */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1;
  const push = (k: Tok['k'], v: string, start: number) => out.push({ k, v, raw: src.slice(start, i), line, pos: start, end: i });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('(*', i) || src.startsWith('/*', i)) {
      const close = src[i] === '(' ? '*)' : '*/';
      const j = src.indexOf(close, i + 2);
      if (j < 0) throw new StError('Comment never closed', line);
      for (let k = i; k < j; k++) if (src[k] === '\n') line++;
      i = j + 2;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      push('num', m[0].replace(/_/g, ''), start);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      i += m[0].length;
      const up = m[0].toUpperCase();
      // REAL#1.5-style typed literals: keep the number.
      if (src[i] === '#' && /[0-9.]/.test(src[i + 1] ?? '')) { i++; continue; }
      push(KEYWORDS.has(up) ? 'kw' : 'id', up, start);
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([':=', '<=', '>=', '<>', '**', '=>'].includes(two)) { i += 2; push('op', two, start); continue; }
    if ('+-*/()=<>;,:&'.includes(c)) { i++; push('op', c, start); continue; }
    throw new StError(`Unexpected character "${c}"`, line);
  }
  out.push({ k: 'eof', v: '', raw: '', line, pos: i, end: i });
  return out;
}

type Env = { vals: Float64Array; budget: number };
type Expr = (env: Env) => number;
type Stmt = (env: Env) => 'exit' | 'return' | void;
type Arg = { name: string | null; e: Expr };

const FUNCS: Record<string, { n: number[]; f: (a: number[], named: Record<string, number>) => number; names?: string[] }> = {
  ABS: { n: [1], f: ([x]) => Math.abs(x) }, SQRT: { n: [1], f: ([x]) => Math.sqrt(x) }, EXP: { n: [1], f: ([x]) => Math.exp(x) },
  LN: { n: [1], f: ([x]) => Math.log(x) }, LOG: { n: [1], f: ([x]) => Math.log10(x) },
  SIN: { n: [1], f: ([x]) => Math.sin(x) }, COS: { n: [1], f: ([x]) => Math.cos(x) }, TAN: { n: [1], f: ([x]) => Math.tan(x) },
  ASIN: { n: [1], f: ([x]) => Math.asin(x) }, ACOS: { n: [1], f: ([x]) => Math.acos(x) }, ATAN: { n: [1], f: ([x]) => Math.atan(x) },
  EXPT: { n: [2], f: ([x, y]) => x ** y, names: ['IN1', 'IN2'] },
  MIN: { n: [2, 3, 4, 5, 6, 7, 8], f: (a) => Math.min(...a), names: ['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8'] },
  MAX: { n: [2, 3, 4, 5, 6, 7, 8], f: (a) => Math.max(...a), names: ['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8'] },
  LIMIT: { n: [3], f: ([mn, x, mx]) => Math.min(mx, Math.max(mn, x)), names: ['MN', 'IN', 'MX'] },
  SEL: { n: [3], f: ([g, a, b]) => (g ? b : a), names: ['G', 'IN0', 'IN1'] },
  TRUNC: { n: [1], f: ([x]) => Math.trunc(x) }, ROUND: { n: [1], f: ([x]) => Math.round(x) },
};
const isConversion = (name: string) => /^[A-Z]+_TO_[A-Z]+$/.test(name);

export type StProgram = {
  vars: StVar[];
  /** Index of each variable (declared or built in) in the value array. */
  index: Map<string, number>;
  body: Stmt[];
  /** Built-in names, in order: the inputs, then the outputs. */
  inputs: string[];
  outputs: string[];
};

/**
 * Compile a program. `inputs` are set before each run (read-only to the
 * program); `outputs` are written by it and kept between runs.
 */
export function compileSt(src: string, inputs: string[], outputs: string[]): StProgram {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const is = (v: string) => (peek().k === 'op' || peek().k === 'kw') && peek().v === v;
  const expect = (v: string) => {
    if (!is(v)) throw new StError(`Expected "${v}" but found "${peek().v || 'the end'}"`, peek().line);
    return next();
  };
  const index = new Map<string, number>();
  inputs.forEach((n) => index.set(n, index.size));
  outputs.forEach((n) => index.set(n, index.size));
  const vars: StVar[] = [];
  const types = new Map<string, StType>();
  const readOnly = new Set(inputs);

  // Declarations (anywhere at the top level, before or between statements).
  const declarations = () => {
    while (is('VAR') || is('VAR_TEMP')) {
      next();
      while (!is('END_VAR')) {
        const t = next();
        if (t.k !== 'id') throw new StError(`Expected a variable name, found "${t.v || 'the end'}"`, t.line);
        const names = [t.v];
        while (is(',')) { next(); const u = next(); if (u.k !== 'id') throw new StError('Expected a variable name', u.line); names.push(u.v); }
        expect(':');
        const ty = next();
        if (!['REAL', 'LREAL', 'INT', 'DINT', 'BOOL'].includes(ty.v)) throw new StError(`Unknown type "${ty.v}" (REAL, LREAL, INT, DINT or BOOL)`, ty.line);
        let init = 0;
        if (is(':=')) { next(); init = constant(); }
        expect(';');
        for (const name of names) {
          if (index.has(name)) throw new StError(`"${t.raw}" is already declared${readOnly.has(name) || outputs.includes(name) ? ' (it is built in)' : ''}`, t.line);
          index.set(name, index.size);
          types.set(name, ty.v as StType);
          vars.push({ name, type: ty.v as StType, init, line: t.line });
        }
      }
      next();
    }
  };
  const constant = () => {
    const e = expr();
    return e({ vals: new Float64Array(index.size + 1), budget: 1e4 });
  };

  // Expressions, by precedence.
  const binary = (sub: () => Expr, ops: Record<string, (a: number, b: number) => number>) => () => {
    let left = sub();
    while ((peek().k === 'op' || peek().k === 'kw') && peek().v in ops) {
      const f = ops[next().v];
      const l = left, r = sub();
      left = (env) => f(l(env), r(env));
    }
    return left;
  };
  const b = (x: boolean) => (x ? 1 : 0);
  const primary = (): Expr => {
    const t = next();
    if (t.k === 'num') { const v = Number(t.v); if (!Number.isFinite(v)) throw new StError(`Bad number "${t.v}"`, t.line); return () => v; }
    if (t.v === 'TRUE') return () => 1;
    if (t.v === 'FALSE') return () => 0;
    if (t.v === '(') { const e = expr(); expect(')'); return e; }
    if (t.v === '-') { const e = unary(); return (env) => -e(env); }
    if (t.v === '+') return unary();
    if (t.v === 'NOT') { const e = unary(); return (env) => b(!e(env)); }
    if (t.k === 'id' && is('(')) return call(t);
    if (t.k === 'id') {
      const i = index.get(t.v);
      if (i === undefined) throw new StError(`"${t.raw}" isn't declared`, t.line);
      return (env) => env.vals[i];
    }
    throw new StError(`Unexpected "${t.v || 'end of program'}"`, t.line);
  };
  const call = (t: Tok): Expr => {
    expect('(');
    const args: Arg[] = [];
    while (!is(')')) {
      let name: string | null = null;
      if (peek().k === 'id' && toks[p + 1]?.v === ':=') { name = next().v; next(); }
      args.push({ name, e: expr() });
      if (!is(')')) expect(',');
    }
    next();
    if (isConversion(t.v)) {
      if (args.length !== 1) throw new StError(`${t.v} takes one argument`, t.line);
      const e = args[0].e, to = t.v.split('_TO_')[1];
      return to === 'BOOL' ? (env) => b(e(env) !== 0) : /INT$/.test(to) ? (env) => Math.round(e(env)) : e;
    }
    const fn = FUNCS[t.v];
    if (!fn) throw new StError(`Unknown function "${t.raw}"`, t.line);
    if (!fn.n.includes(args.length)) throw new StError(`${t.v} takes ${fn.n.join(' or ')} argument${fn.n[0] > 1 ? 's' : ''}`, t.line);
    // Named arguments go in their place.
    const order = args.map((a, i) => {
      if (!a.name) return i;
      const k = fn.names?.indexOf(a.name) ?? -1;
      if (k < 0) throw new StError(`${t.v} has no input ${a.name}${fn.names ? ` (${fn.names.slice(0, Math.max(...fn.n)).join(', ')})` : ''}`, t.line);
      return k;
    });
    const es: Expr[] = [];
    args.forEach((a, i) => { es[order[i]] = a.e; });
    if (es.some((e) => !e) || es.length !== args.length) throw new StError(`${t.v}: arguments missing`, t.line);
    return (env) => fn.f(es.map((e) => e(env)), {});
  };
  const power = (): Expr => {
    const base = primary();
    if (is('**')) { next(); const ex = unary(); return (env) => base(env) ** ex(env); }
    return base;
  };
  const unary = (): Expr => power();
  const term = binary(unary, { '*': (x, y) => x * y, '/': (x, y) => x / y, MOD: (x, y) => x % y });
  const sum = binary(term, { '+': (x, y) => x + y, '-': (x, y) => x - y });
  const comparison = binary(sum, { '<': (x, y) => b(x < y), '>': (x, y) => b(x > y), '<=': (x, y) => b(x <= y), '>=': (x, y) => b(x >= y), '=': (x, y) => b(x === y), '<>': (x, y) => b(x !== y) });
  const and = binary(comparison, { AND: (x, y) => b(!!x && !!y), '&': (x, y) => b(!!x && !!y) });
  const xor = binary(and, { XOR: (x, y) => b(!!x !== !!y) });
  const expr: () => Expr = binary(xor, { OR: (x, y) => b(!!x || !!y) });

  // Statements.
  const store = (name: string, line: number, raw = name) => {
    if (readOnly.has(name)) throw new StError(`${raw} is an input: it can't be written`, line);
    const i = index.get(name);
    if (i === undefined) throw new StError(`"${raw}" isn't declared`, line);
    const ty = types.get(name);
    if (ty === 'INT' || ty === 'DINT') return (env: Env, v: number) => { env.vals[i] = Math.trunc(v); };
    if (ty === 'BOOL') return (env: Env, v: number) => { env.vals[i] = v ? 1 : 0; };
    return (env: Env, v: number) => { env.vals[i] = v; };
  };
  const tick = (env: Env, line: number) => {
    if (--env.budget < 0) throw new StError('More than 100 000 steps in one cycle: an endless loop?', line);
  };
  const block = (...ends: string[]): Stmt[] => {
    const out: Stmt[] = [];
    while (!ends.some(is) && peek().k !== 'eof') { declarations(); if (!ends.some(is) && peek().k !== 'eof') out.push(statement()); }
    return out;
  };
  const run = (list: Stmt[], env: Env) => {
    for (const s of list) { const r = s(env); if (r) return r; }
    return undefined;
  };
  const statement = (): Stmt => {
    const t = peek();
    if (is(';')) { next(); return () => undefined; }
    if (t.v === 'IF') {
      next();
      const arms: { c: Expr; body: Stmt[] }[] = [];
      const c = expr(); expect('THEN');
      arms.push({ c, body: block('ELSIF', 'ELSE', 'END_IF') });
      while (is('ELSIF')) { next(); const c2 = expr(); expect('THEN'); arms.push({ c: c2, body: block('ELSIF', 'ELSE', 'END_IF') }); }
      let otherwise: Stmt[] = [];
      if (is('ELSE')) { next(); otherwise = block('END_IF'); }
      expect('END_IF'); if (is(';')) next();
      return (env) => {
        tick(env, t.line);
        for (const a of arms) if (a.c(env)) return run(a.body, env);
        return run(otherwise, env);
      };
    }
    if (t.v === 'FOR') {
      next();
      const v = next();
      if (v.k !== 'id') throw new StError('Expected the loop variable', v.line);
      const set = store(v.v, v.line, v.raw), i = index.get(v.v)!;
      expect(':='); const from = expr(); expect('TO'); const to = expr();
      let by: Expr = () => 1;
      if (is('BY')) { next(); by = expr(); }
      expect('DO'); const body = block('END_FOR'); expect('END_FOR'); if (is(';')) next();
      return (env) => {
        const end = to(env), step = by(env);
        if (step === 0) throw new StError('FOR … BY 0 never ends', t.line);
        for (set(env, from(env)); step > 0 ? env.vals[i] <= end : env.vals[i] >= end; set(env, env.vals[i] + step)) {
          tick(env, t.line);
          const r = run(body, env);
          if (r === 'exit') break;
          if (r === 'return') return r;
        }
        return undefined;
      };
    }
    if (t.v === 'WHILE') {
      next(); const c = expr(); expect('DO'); const body = block('END_WHILE'); expect('END_WHILE'); if (is(';')) next();
      return (env) => {
        while (c(env)) { tick(env, t.line); const r = run(body, env); if (r === 'exit') break; if (r === 'return') return r; }
        return undefined;
      };
    }
    if (t.v === 'REPEAT') {
      next(); const body = block('UNTIL'); expect('UNTIL'); const c = expr(); expect('END_REPEAT'); if (is(';')) next();
      return (env) => {
        do { tick(env, t.line); const r = run(body, env); if (r === 'exit') break; if (r === 'return') return r; } while (!c(env));
        return undefined;
      };
    }
    if (t.v === 'EXIT') { next(); expect(';'); return () => 'exit'; }
    if (t.v === 'RETURN') { next(); expect(';'); return () => 'return'; }
    if (t.k === 'id') {
      next();
      if (!is(':=')) throw new StError(is('(') ? `A function call on its own does nothing: assign its result` : `Expected ":=" after ${t.raw}`, t.line);
      const set = store(t.v, t.line, t.raw);
      next();
      const e = expr(); expect(';');
      return (env) => { tick(env, t.line); set(env, e(env)); return undefined; };
    }
    throw new StError(`Unexpected "${t.v || 'end of program'}"`, t.line);
  };

  const body: Stmt[] = [];
  while (peek().k !== 'eof') {
    declarations();
    if (peek().k !== 'eof') body.push(statement());
  }
  return { vars, index, body, inputs, outputs };
}

/** A compiled program with its statics, run once per cycle. */
export class StRunner {
  private vals: Float64Array;
  constructor(readonly prog: StProgram) {
    this.vals = new Float64Array(prog.index.size);
    for (const v of prog.vars) this.vals[prog.index.get(v.name)!] = v.init;
  }

  /** One cycle: set the inputs, run, read the outputs. Throws StError on a runtime problem. */
  run(inputs: Record<string, number>): Record<string, number> {
    for (const name of this.prog.inputs) this.vals[this.prog.index.get(name)!] = inputs[name] ?? 0;
    const env: Env = { vals: this.vals, budget: 1e5 };
    for (const s of this.prog.body) if (s(env) === 'return') break;
    const out: Record<string, number> = {};
    for (const name of this.prog.outputs) out[name] = this.vals[this.prog.index.get(name)!];
    return out;
  }

  /** Read a variable (for the faceplate's watch list). */
  get(name: string) { const i = this.prog.index.get(name.toUpperCase()); return i === undefined ? NaN : this.vals[i]; }
  set(name: string, v: number) { const i = this.prog.index.get(name.toUpperCase()); if (i !== undefined) this.vals[i] = v; }
}

/**
 * The same code as an SCL body: locals and inputs get TIA's # prefix (named
 * function arguments like MN := don't), comments and layout kept.
 */
export function toScl(src: string, names: Set<string>) {
  const toks = tokenize(src);
  let out = '', last = 0;
  toks.forEach((t, i) => {
    if (t.k !== 'id' || !names.has(t.v)) return;
    const prev = toks[i - 1], nxt = toks[i + 1];
    if (nxt?.v === ':=' && (prev?.v === '(' || prev?.v === ',')) return; // a named argument
    out += src.slice(last, t.pos) + '#';
    last = t.pos;
  });
  return out + src.slice(last);
}

/** The program without its VAR blocks (for exporting the body under the FB's own declarations). */
export function stripDeclarations(src: string) {
  return src.replace(/^\s*VAR(?:_TEMP)?\b[\s\S]*?\bEND_VAR\s*;?\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
}
