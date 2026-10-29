/** A number for LaTeX: 3 significant figures, ×10ⁿ for very small or large values. */
export function texNum(v: number) {
  if (!Number.isFinite(v)) return '\\infty';
  const n = Number(v.toPrecision(3));
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    const [m, e] = n.toExponential(2).split('e');
    return `${Number(m)}\\times10^{${Number(e)}}`;
  }
  return String(n);
}
