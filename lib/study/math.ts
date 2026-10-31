// Math in what an AI writes. Questions carry LaTeX between dollar signs, and JSON
// is hard on it: `\alpha` isn't a legal escape, and `\frac` or `\times` are legal
// ones that quietly turn into a form feed or a tab. These repair that, split text
// for display, and flatten math for places that can only show plain text. Pure.

/** LaTeX commands that start with a letter JSON treats as an escape. */
const LATEX_WORDS = new Set([
  'beta', 'bar', 'bf', 'binom', 'begin', 'big', 'bigg', 'bullet', 'boldsymbol',
  'frac', 'forall',
  'nu', 'neq', 'ne', 'nabla', 'neg', 'ni', 'not',
  'rho', 'right', 'rightarrow', 'rm', 'rangle', 'rfloor', 'rceil',
  'times', 'text', 'textbf', 'tau', 'theta', 'tan', 'to', 'tilde', 'tfrac', 'top', 'therefore',
]);

/** Double the backslashes of LaTeX commands in raw JSON, before it's parsed. Real escapes like a newline are left alone. */
export function repairMathEscapes(raw: string) {
  return raw.replace(/\\([\s\S])/g, (match, next: string, offset: number) => {
    if (next === '\\' || next === '"' || next === '/') return match;
    const rest = raw.slice(offset + 1);
    if (next === 'u') return /^u[0-9a-fA-F]{4}/.test(rest) ? match : `\\\\${next}`;
    if ('bfnrt'.includes(next)) return LATEX_WORDS.has(/^[a-zA-Z]+/.exec(rest)?.[0] ?? '') ? `\\\\${next}` : match;
    return `\\\\${next}`;
  });
}

const ESCAPE_LETTER: Record<string, string> = { '\b': 'b', '\f': 'f', '\n': 'n', '\r': 'r', '\t': 't' };

/** The same repair on text already parsed, for tests saved before it existed: `\frac` came through as a form feed and "rac". */
export function repairStoredMath(text: string) {
  return text.replace(/[\b\f\n\r\t](?=[a-zA-Z])/g, (char, offset: number) => {
    const letter = ESCAPE_LETTER[char];
    const word = letter + (/^[a-zA-Z]+/.exec(text.slice(offset + 1))?.[0] ?? '');
    return LATEX_WORDS.has(word) ? `\\${letter}` : char;
  });
}

export type MathPart = { math: boolean; text: string; display?: boolean };

/** Is this `$` at `i` able to open math? Not before a space, so "$5 and $10" stays money. */
const canOpen = (text: string, i: number) => !!text[i + 1] && !/\s/.test(text[i + 1]);

function closingDollar(text: string, from: number) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '$' && !/\s/.test(text[i - 1]) && !/\d/.test(text[i + 1] ?? '')) return i;
  }
  return -1;
}

/** Text as runs of words and math. A `$` that never closes but is plainly math runs to the end, since AIs do forget. */
export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let plain = '';
  const flush = () => {
    if (plain) parts.push({ math: false, text: plain });
    plain = '';
  };
  const math = (body: string, display = false) => {
    flush();
    parts.push({ math: true, text: body, ...(display ? { display: true } : {}) });
  };
  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    const fence = pair === '$$' ? '$$' : pair === '\\[' ? '\\]' : pair === '\\(' ? '\\)' : null;
    if (fence) {
      const end = text.indexOf(fence, i + 2);
      if (end > 0) {
        math(text.slice(i + 2, end), fence !== '\\)');
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '$' && canOpen(text, i)) {
      const end = closingDollar(text, i + 1);
      if (end > 0) {
        math(text.slice(i + 1, end));
        i = end;
        continue;
      }
      const rest = text.slice(i + 1);
      if (/[_^\\]/.test(rest)) {
        math(rest);
        break;
      }
    }
    plain += text[i];
  }
  flush();
  return parts;
}

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', omega: 'ω',
  times: '×', cdot: '·', div: '÷', pm: '±', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '~', to: '→', rightarrow: '→', leftarrow: '←', uparrow: '↑', downarrow: '↓', degree: '°', infty: '∞',
};
const SUBSCRIPT: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋' };
const SUPERSCRIPT: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' };

const script = (body: string, map: Record<string, string>, fallback: string) =>
  ([...body].every((c) => map[c]) ? [...body].map((c) => map[c]).join('') : `${fallback}${body}`);

function flatten(math: string) {
  let out = math;
  // Innermost first, so PO₂ survives in P_{O_2}.
  for (let pass = 0; pass < 4; pass++) {
    out = out
      .replace(/\\(?:text|textbf|mathrm|mathbf|operatorname|rm)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\t?d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/_\{([^{}]*)\}/g, (_, body: string) => script(body, SUBSCRIPT, ''))
      .replace(/\^\{([^{}]*)\}/g, (_, body: string) => script(body, SUPERSCRIPT, '^'))
      .replace(/_([0-9])/g, (_, body: string) => SUBSCRIPT[body])
      .replace(/\^([0-9])/g, (_, body: string) => SUPERSCRIPT[body]);
  }
  return out
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? (['left', 'right', 'quad', 'qquad', ',', 'displaystyle'].includes(name) ? '' : name))
    .replace(/\\([%#&$_{}])/g, '$1')
    .replace(/\\[,;! ]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Readable text with no math in it, for places that can't typeset: a TV in a party game. */
export const mathToPlain = (text: string) => splitMath(text).map((part) => (part.math ? flatten(part.text) : part.text)).join('');
