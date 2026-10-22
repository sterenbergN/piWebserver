// The calculator's "pretty print" editor: an expression as a tree, so fractions,
// roots and powers can be typed as stacked boxes and nested inside each other.
// It turns into a plain expression string for evaluate() (expr.ts).

export type MathNode =
  | { k: 'ch'; c: string }
  | { k: 'frac'; num: MathRow; den: MathRow }
  | { k: 'root'; n: 2 | 3; body: MathRow }
  /** A superscript on whatever comes before it. */
  | { k: 'pow'; exp: MathRow };
export type MathRow = MathNode[];
export type Cursor = { row: MathRow; i: number };

/** The boxes inside a node, first to last. */
export function rowsOf(n: MathNode): MathRow[] {
  switch (n.k) {
    case 'frac': return [n.num, n.den];
    case 'root': return [n.body];
    case 'pow': return [n.exp];
    default: return [];
  }
}

const isEmptyNode = (n: MathNode) => n.k !== 'ch' && rowsOf(n).every((r) => r.length === 0);
const isWordChar = (n: MathNode | undefined) => n?.k === 'ch' && /^[0-9a-z.]$/i.test(n.c);
const isLetter = (n: MathNode | undefined) => n?.k === 'ch' && /^[a-z]$/i.test(n.c);

/** Where the operand ending at `end` starts (for a fraction to take as its numerator). */
function operandStart(row: MathRow, end: number): number {
  if (end === 0) return 0;
  const prev = row[end - 1];
  if (prev.k === 'pow') return operandStart(row, end - 1); // x² takes its base along
  if (prev.k === 'frac' || prev.k === 'root') return end - 1;
  if (prev.k === 'ch' && prev.c === ')') {
    let depth = 0;
    for (let j = end - 1; j >= 0; j--) {
      const n = row[j];
      if (n.k !== 'ch') continue;
      if (n.c === ')') depth++;
      else if (n.c === '(' && --depth === 0) {
        while (j > 0 && isLetter(row[j - 1])) j--; // sin(…)
        return j;
      }
    }
    return end;
  }
  let j = end;
  while (j > 0 && isWordChar(row[j - 1])) j--;
  return j;
}

function serialize(row: MathRow): string {
  return row.map((n) => {
    switch (n.k) {
      case 'ch': return n.c;
      case 'frac': return `((${serialize(n.num)})/(${serialize(n.den)}))`;
      case 'root': return `${n.n === 3 ? 'cbrt' : 'sqrt'}(${serialize(n.body)})`;
      case 'pow': return `^(${serialize(n.exp)})`;
    }
  }).join('');
}

export class MathEditor {
  root: MathRow = [];
  cursor: Cursor = { row: this.root, i: 0 };

  isEmpty() { return this.root.length === 0; }
  toExpression() { return serialize(this.root); }

  clear() { this.root.length = 0; this.cursor = { row: this.root, i: 0 }; }

  setText(text: string) {
    this.clear();
    this.insertText(text);
  }

  insertText(text: string) {
    for (const c of text) {
      this.cursor.row.splice(this.cursor.i, 0, { k: 'ch', c });
      this.cursor.i++;
    }
  }

  /** A fraction; whatever is just before the cursor becomes its numerator. */
  insertFraction() {
    const { row, i } = this.cursor;
    const start = operandStart(row, i);
    const num = row.splice(start, i - start);
    const node: MathNode = { k: 'frac', num, den: [] };
    row.splice(start, 0, node);
    this.cursor = num.length ? { row: node.den, i: 0 } : { row: num, i: 0 };
  }

  insertRoot(n: 2 | 3) {
    const node: MathNode = { k: 'root', n, body: [] };
    this.cursor.row.splice(this.cursor.i, 0, node);
    this.cursor = { row: node.body, i: 0 };
  }

  /** A power box; with `exp` filled in (x²) the cursor stays after it. */
  insertPower(exp?: string) {
    const node: MathNode = { k: 'pow', exp: [] };
    this.cursor.row.splice(this.cursor.i, 0, node);
    if (exp) {
      for (const c of exp) node.exp.push({ k: 'ch', c });
      this.cursor.i++;
    } else {
      this.cursor = { row: node.exp, i: 0 };
    }
  }

  /** The node a row belongs to, and where that node sits. */
  parentOf(target: MathRow, row: MathRow = this.root): { node: MathNode; row: MathRow; i: number } | null {
    for (let i = 0; i < row.length; i++) {
      for (const inner of rowsOf(row[i])) {
        if (inner === target) return { node: row[i], row, i };
        const found = this.parentOf(target, inner);
        if (found) return found;
      }
    }
    return null;
  }

  backspace() {
    const { row, i } = this.cursor;
    if (i > 0) {
      const prev = row[i - 1];
      if (prev.k === 'ch' || isEmptyNode(prev)) { row.splice(i - 1, 1); this.cursor.i--; return; }
      const inner = rowsOf(prev);
      const last = inner[inner.length - 1];
      this.cursor = { row: last, i: last.length };
      return;
    }
    const p = this.parentOf(row);
    if (!p) return;
    if (isEmptyNode(p.node)) {
      p.row.splice(p.i, 1);
      this.cursor = { row: p.row, i: p.i };
    } else if (p.node.k === 'frac' && row === p.node.den) {
      this.cursor = { row: p.node.num, i: p.node.num.length };
    } else if (p.node.k === 'root') {
      // Take the root off and keep what was under it.
      p.row.splice(p.i, 1, ...p.node.body);
      this.cursor = { row: p.row, i: p.i };
    } else {
      this.cursor = { row: p.row, i: p.i };
    }
  }

  left() {
    const { row, i } = this.cursor;
    if (i > 0) {
      const prev = row[i - 1];
      const inner = rowsOf(prev);
      if (!inner.length) { this.cursor.i--; return; }
      const last = inner[inner.length - 1];
      this.cursor = { row: last, i: last.length };
      return;
    }
    const p = this.parentOf(row);
    if (!p) return;
    if (p.node.k === 'frac' && row === p.node.den) this.cursor = { row: p.node.num, i: p.node.num.length };
    else this.cursor = { row: p.row, i: p.i };
  }

  right() {
    const { row, i } = this.cursor;
    if (i < row.length) {
      const inner = rowsOf(row[i]);
      if (!inner.length) { this.cursor.i++; return; }
      this.cursor = { row: inner[0], i: 0 };
      return;
    }
    const p = this.parentOf(row);
    if (!p) return;
    if (p.node.k === 'frac' && row === p.node.num) this.cursor = { row: p.node.den, i: 0 };
    else this.cursor = { row: p.row, i: p.i + 1 };
  }

  /** Between numerator and denominator. */
  vertical(dir: 'up' | 'down') {
    for (let row = this.cursor.row, p = this.parentOf(row); p; row = p.row, p = this.parentOf(row)) {
      if (p.node.k !== 'frac') continue;
      const to = dir === 'up' ? p.node.num : p.node.den;
      if (to === row) continue;
      this.cursor = { row: to, i: to.length };
      return;
    }
  }

  home() { this.cursor = { row: this.cursor.row, i: 0 }; }
  end() { this.cursor = { row: this.cursor.row, i: this.cursor.row.length }; }
  moveTo(row: MathRow, i: number) { this.cursor = { row, i }; }
}
