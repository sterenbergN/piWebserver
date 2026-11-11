// A daily question's prompt as plain text, for writing at the top of a notes page. Prompts use
// LaTeX between dollar signs; a text box can't draw that, so the common parts become the
// characters they stand for, and anything left over just loses its backslash.

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '~',
  infty: '∞', degree: '°', circ: '°', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', partial: '∂', nabla: '∇', sum: 'Σ', int: '∫',
  sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥', propto: '∝', cdots: '…', ldots: '…', dots: '…', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '',
};

/** Accents, as the combining marks that draw them over a letter. */
const ACCENTS: Record<string, string> = { dot: '̇', ddot: '̈', hat: '̂', bar: '̄', vec: '⃗', tilde: '̃' };

/** One {group} after a command, with what's left after it. */
function group(text: string, at: number): [string, number] | null {
  if (text[at] !== '{') return null;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (!depth) return [text.slice(at + 1, i), i + 1];
    }
  }
  return null;
}

function plainLatex(latex: string): string {
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const char = latex[i];
    if (char === '\\') {
      const name = /^\\([A-Za-z]+|.)/.exec(latex.slice(i))![1];
      i += name.length + 1;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const top = group(latex, i);
        const bottom = top && group(latex, top[1]);
        if (top && bottom) {
          const wrap = (part: string) => (/^[\w.]+$/.test(part) ? part : `(${part})`);
          out += `${wrap(plainLatex(top[0]))}/${wrap(plainLatex(bottom[0]))}`;
          i = bottom[1];
          continue;
        }
      }
      if (name === 'sqrt') {
        const inside = group(latex, i);
        if (inside) {
          out += `√(${plainLatex(inside[0])})`;
          i = inside[1];
          continue;
        }
      }
      if (name in ACCENTS) {
        let at = i;
        while (latex[at] === ' ') at += 1; // \dot m, without braces
        const inside = group(latex, at) ?? (latex[at] ? [latex[at], at + 1] as [string, number] : null);
        if (inside) {
          // Ṫ for \dot{T}: a combining mark on one letter; longer things just lose the accent.
          const body = plainLatex(inside[0]);
          out += [...body].length === 1 ? `${body}${ACCENTS[name]}` : body;
          i = inside[1];
          continue;
        }
      }
      if (['text', 'mathrm', 'mathbf', 'mathit', 'operatorname', 'textbf', 'textit', 'mathsf', 'boldsymbol', 'overline'].includes(name)) {
        const inside = group(latex, i);
        if (inside) {
          out += plainLatex(inside[0]);
          i = inside[1];
          continue;
        }
      }
      if (name === 'left' || name === 'right' || name === 'displaystyle') continue;
      out += SYMBOLS[name] ?? name;
      continue;
    }
    if ((char === '^' || char === '_') && latex[i + 1] === '{') {
      const inside = group(latex, i + 1);
      if (inside) {
        const body = plainLatex(inside[0]);
        // A degree is written as ^{\circ}: it's a degree sign, not a power.
        out += char === '^' && body === '°' ? '°' : `${char}${body.length > 1 ? `(${body})` : body}`;
        i = inside[1];
        continue;
      }
    }
    if (char === '{' || char === '}') { i += 1; continue; }
    out += char;
    i += 1;
  }
  return out;
}

export function mathToPlain(text: string) {
  return text
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g, (_, block: string | undefined, inline: string | undefined) => plainLatex(block ?? inline ?? ''))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
