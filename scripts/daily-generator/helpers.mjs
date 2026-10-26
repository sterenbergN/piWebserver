// Small builders so each question reads like the question, not like JSON.
// Math uses String.raw so LaTeX backslashes stay as written.

export const num = (id, value, unit, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'numeric', value, ...(unit ? { unit } : {}), ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}), ...(opts.abs !== undefined ? { abs: opts.abs } : {}) },
  ...(opts.mistakes ? { mistakes: opts.mistakes } : {}),
});

export const choice = (id, options, correct, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'choice', options, correct },
  ...(opts.mistakes ? { mistakes: opts.mistakes } : {}),
});

export const multi = (id, options, correct, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'multi', options, correct },
});

export const range = (id, min, max, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'range', min, max, ...(opts.abs !== undefined ? { abs: opts.abs } : {}) },
});

export const coeffs = (id, numerator, denominator, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'coefficients', numerator, denominator },
});

export const order = (id, items, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'order', items },
});

/** A solution diagram: put ![](figure:<id>) in the solution where it should appear. */
export const fig = (id, svg, alt, caption) => ({ id, svg, alt, ...(caption ? { caption } : {}) });

// ─── Plots ───────────────────────────────────────────────────────────────────
// Graphs in figures are computed, never drawn by eye: give plot() the function
// (or the points) and it draws them to scale.

const COLORS = ['#1f6fd1', '#d95926', '#199e70', '#8a5cd6'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (v) => {
  const n = Number(v.toPrecision(6));
  return (Object.is(n, -0) ? 0 : n).toString().replace('-', '−');
};

/** About `count` round tick values (steps of 1, 2 or 5 × 10ⁿ) covering [min, max]. */
function ticks(min, max, count = 5) {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * A line chart as SVG markup (dark on white, for a figure or solution figure).
 *
 *   plot({
 *     x: { min: 0, max: 4, label: 'Time t (s)' },
 *     y: { min: 0, max: 1.4, label: 'Output y' },
 *     series: [{ fn: step2(0.4, 5), label: 'Step response' },          // a function of x
 *              { points: [[0, 0], [4, 1]], label: 'Ramp', dash: true }], // or points
 *     hlines: [{ y: 1, label: 'Setpoint' }],
 *     vlines: [{ x: 0.686, label: 'tp = 0.69 s' }],
 *     bands: [{ from: 0.98, to: 1.02, label: '±2 % band' }],
 *     marks: [{ x: 0.686, y: 1.254, label: 'Peak 1.25' }, { x: -2, y: 4.58, shape: 'x' }],
 *     zeroAxes: true,    // draw x = 0 and y = 0 (an s-plane)
 *     equalAspect: true, // same scale on both axes, so circles and angles look right
 *   })
 */
export function plot({ width = 480, height = 280, x, y, series = [], hlines = [], vlines = [], bands = [], marks = [], zeroAxes = false, equalAspect = false }) {
  const labelled = series.filter((s) => s.label);
  const legendRows = Math.ceil(labelled.length / 3);
  const pad = { l: 56, r: 18, t: 16, b: 46 + legendRows * 18 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  if (equalAspect) {
    // Same scale on both axes (an s-plane, a geometry sketch): widen the range that has room to spare.
    const scale = Math.min(w / (x.max - x.min), h / (y.max - y.min));
    const widen = (r, size) => ({ ...r, min: (r.min + r.max) / 2 - size / scale / 2, max: (r.min + r.max) / 2 + size / scale / 2 });
    x = widen(x, w);
    y = widen(y, h);
  }
  const px = (v) => pad.l + ((v - x.min) / (x.max - x.min)) * w;
  const py = (v) => pad.t + (1 - (v - y.min) / (y.max - y.min)) * h;
  const f1 = (v) => v.toFixed(1);
  const out = [];
  const text = (tx, ty, s, attrs = '') => out.push(`<text x="${f1(tx)}" y="${f1(ty)}" ${attrs}>${esc(s)}</text>`);

  // Labels inside the chart: each tries its spots in turn and takes the first
  // that stays inside the frame and clear of the labels and points already placed.
  const taken = [];
  const labels = [];
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const place = (s, spots, color = '#111827') => {
    const tw = s.length * 6.2 + 2;
    const box = ([sx, sy, anchor]) => {
      const left = anchor === 'end' ? sx - tw : anchor === 'middle' ? sx - tw / 2 : sx;
      return [left, sy - 10, left + tw, sy + 3];
    };
    const inside = (b) => b[0] >= pad.l + 1 && b[2] <= pad.l + w - 1 && b[1] >= pad.t + 1 && b[3] <= pad.t + h - 1;
    const clashes = (p) => taken.filter((t) => overlaps(t, box(p))).length + (inside(box(p)) ? 0 : 100);
    const spot = spots.reduce((best, p) => (clashes(p) < clashes(best) ? p : best));
    taken.push(box(spot));
    labels.push([spot, s, color]);
  };

  out.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);
  out.push(`<defs><clipPath id="area"><rect x="${pad.l}" y="${pad.t}" width="${w}" height="${h}"/></clipPath></defs>`);
  for (const t of ticks(x.min, x.max)) {
    out.push(`<line x1="${f1(px(t))}" y1="${pad.t}" x2="${f1(px(t))}" y2="${pad.t + h}" stroke="#e5e7eb"/>`);
    text(px(t), pad.t + h + 16, tidy(t), 'text-anchor="middle" fill="#4b5563"');
  }
  for (const t of ticks(y.min, y.max)) {
    out.push(`<line x1="${pad.l}" y1="${f1(py(t))}" x2="${pad.l + w}" y2="${f1(py(t))}" stroke="#e5e7eb"/>`);
    text(pad.l - 6, py(t) + 4, tidy(t), 'text-anchor="end" fill="#4b5563"');
  }
  for (const b of bands) {
    const top = py(Math.max(b.from, b.to));
    out.push(`<rect x="${pad.l}" y="${f1(top)}" width="${w}" height="${f1(Math.abs(py(b.from) - py(b.to)))}" fill="#c98500" fill-opacity="0.18"/>`);
  }
  if (zeroAxes) {
    if (x.min < 0 && x.max > 0) out.push(`<line x1="${f1(px(0))}" y1="${pad.t}" x2="${f1(px(0))}" y2="${pad.t + h}" stroke="#374151"/>`);
    if (y.min < 0 && y.max > 0) out.push(`<line x1="${pad.l}" y1="${f1(py(0))}" x2="${pad.l + w}" y2="${f1(py(0))}" stroke="#374151"/>`);
  }
  for (const l of hlines) out.push(`<line x1="${pad.l}" y1="${f1(py(l.y))}" x2="${pad.l + w}" y2="${f1(py(l.y))}" stroke="#6b7280" stroke-dasharray="6 4"/>`);
  for (const l of vlines) out.push(`<line x1="${f1(px(l.x))}" y1="${pad.t}" x2="${f1(px(l.x))}" y2="${pad.t + h}" stroke="#6b7280" stroke-dasharray="2 3"/>`);
  series.forEach((s, i) => {
    const color = s.color ?? COLORS[i % COLORS.length];
    const pts = s.points ?? Array.from({ length: (s.samples ?? 400) + 1 }, (_, k) => {
      const xv = x.min + ((x.max - x.min) * k) / (s.samples ?? 400);
      return [xv, s.fn(xv)];
    });
    let d = '';
    let pen = false;
    for (const [xv, yv] of pts) {
      if (!Number.isFinite(yv)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${f1(px(xv))} ${f1(py(yv))}`;
      pen = true;
    }
    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="7 5"' : ''} clip-path="url(#area)"/>`);
  });
  for (const m of marks) {
    const mx = px(m.x);
    const my = py(m.y);
    taken.push([mx - 6, my - 6, mx + 6, my + 6]);
    out.push(m.shape === 'x'
      ? `<path d="M${f1(mx - 5)} ${f1(my - 5)}L${f1(mx + 5)} ${f1(my + 5)}M${f1(mx - 5)} ${f1(my + 5)}L${f1(mx + 5)} ${f1(my - 5)}" stroke="#111827" stroke-width="2"/>`
      : `<circle cx="${f1(mx)}" cy="${f1(my)}" r="3.5" fill="#111827"/>`);
  }

  // Most important first: points, then the lines, then bands.
  for (const m of marks.filter((m) => m.label)) {
    const mx = px(m.x);
    const my = py(m.y);
    place(m.label, [[mx + 8, my - 8], [mx + 8, my + 16], [mx - 8, my - 8, 'end'], [mx - 8, my + 16, 'end'], [mx + 9, my + 4], [mx - 9, my + 4, 'end']]);
  }
  for (const l of vlines.filter((l) => l.label)) {
    const lx = px(l.x);
    const rows = [0, 1, 2, 3].flatMap((row) => [pad.t + 13 + row * 14, pad.t + h - 6 - row * 14]);
    place(l.label, rows.flatMap((ly) => [[lx + 4, ly], [lx - 4, ly, 'end']]), '#374151');
  }
  for (const l of hlines.filter((l) => l.label)) {
    const ly = py(l.y);
    place(l.label, [[pad.l + 4, ly - 4], [pad.l + 4, ly + 13], [pad.l + w - 4, ly - 4, 'end'], [pad.l + w - 4, ly + 13, 'end'], [pad.l + w / 2, ly - 4, 'middle']], '#374151');
  }
  for (const b of bands.filter((b) => b.label)) {
    const top = py(Math.max(b.from, b.to));
    const bottom = py(Math.min(b.from, b.to));
    place(b.label, [[pad.l + w - 4, top - 4, 'end'], [pad.l + w - 4, bottom + 13, 'end'], [pad.l + 4, top - 4], [pad.l + 4, bottom + 13]], '#8a5a00');
  }
  for (const [[lx, ly, anchor], s, color] of labels) {
    text(lx, ly, s, `${anchor ? `text-anchor="${anchor}" ` : ''}fill="${color}" font-size="11" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`);
  }

  out.push(`<rect x="${pad.l}" y="${pad.t}" width="${w}" height="${h}" fill="none" stroke="#374151"/>`);
  if (x.label) text(pad.l + w / 2, pad.t + h + 34, x.label, 'text-anchor="middle" fill="#111827"');
  if (y.label) text(14, pad.t + h / 2, y.label, `text-anchor="middle" fill="#111827" transform="rotate(-90 14 ${f1(pad.t + h / 2)})"`);
  labelled.forEach((s, i) => {
    const lx = pad.l + (i % 3) * (w / 3);
    const ly = pad.t + h + 50 + Math.floor(i / 3) * 18;
    const color = s.color ?? COLORS[series.indexOf(s) % COLORS.length];
    out.push(`<line x1="${f1(lx)}" y1="${ly - 4}" x2="${f1(lx + 18)}" y2="${ly - 4}" stroke="${color}" stroke-width="2.2"${s.dash ? ' stroke-dasharray="5 3"' : ''}/>`);
    text(lx + 24, ly, s.label, 'fill="#111827" font-size="11"');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" font-family="Arial, Helvetica, sans-serif" font-size="12">${out.join('')}</svg>`;
}

/** Unit-step response of K·ωn² / (s² + 2ζωn s + ωn²), as a function of t (for plot). */
export const step2 = (zeta, wn, K = 1) => (t) => {
  if (t < 0) return 0;
  if (Math.abs(zeta - 1) < 1e-9) return K * (1 - Math.exp(-wn * t) * (1 + wn * t));
  if (zeta < 1) {
    const r = Math.sqrt(1 - zeta * zeta);
    return K * (1 - Math.exp(-zeta * wn * t) * (Math.cos(wn * r * t) + (zeta / r) * Math.sin(wn * r * t)));
  }
  const r = Math.sqrt(zeta * zeta - 1);
  const s1 = -wn * (zeta - r);
  const s2 = -wn * (zeta + r);
  return K * (1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2));
};

/** Unit-step response of K·e^(−θs) / (τs + 1), as a function of t (for plot). */
export const step1 = (tau, K = 1, theta = 0) => (t) => (t < theta ? 0 : K * (1 - Math.exp(-(t - theta) / tau)));

/** Sources used again and again. */
export const SRC = {
  fe: (section) => ({ title: 'NCEES FE Reference Handbook (version 10.x)', detail: section }),
  hibbelerStatics: (detail) => ({ title: 'R. C. Hibbeler, Engineering Mechanics: Statics', detail }),
  hibbelerMoM: (detail) => ({ title: 'R. C. Hibbeler, Mechanics of Materials', detail }),
  cengelThermo: (detail) => ({ title: 'Y. A. Çengel & M. A. Boles, Thermodynamics: An Engineering Approach', detail }),
  incropera: (detail) => ({ title: 'F. P. Incropera et al., Fundamentals of Heat and Mass Transfer', detail }),
  munson: (detail) => ({ title: 'B. R. Munson et al., Fundamentals of Fluid Mechanics', detail }),
  shigley: (detail) => ({ title: 'R. G. Budynas & J. K. Nisbett, Shigley’s Mechanical Engineering Design', detail }),
  rao: (detail) => ({ title: 'S. S. Rao, Mechanical Vibrations', detail }),
  newnan: (detail) => ({ title: 'D. G. Newnan et al., Engineering Economic Analysis', detail }),
  nilsson: (detail) => ({ title: 'J. W. Nilsson & S. A. Riedel, Electric Circuits', detail }),
  chapman: (detail) => ({ title: 'S. J. Chapman, Electric Machinery Fundamentals', detail }),
  bolton: (detail) => ({ title: 'W. Bolton, Mechatronics: Electronic Control Systems in Mechanical and Electrical Engineering', detail }),
  nise: (detail) => ({ title: 'N. S. Nise, Control Systems Engineering', detail }),
  ogata: (detail) => ({ title: 'K. Ogata, Modern Control Engineering', detail }),
  astrom: (detail) => ({ title: 'K. J. Åström & T. Hägglund, PID Controllers: Theory, Design, and Tuning', detail }),
  zn: { title: 'J. G. Ziegler & N. B. Nichols, “Optimum Settings for Automatic Controllers”, Trans. ASME 64 (1942)' },
  iec61131: (detail) => ({ title: 'IEC 61131-3, Programmable controllers – Part 3: Programming languages', detail }),
  iec60204: (detail) => ({ title: 'IEC 60204-1, Safety of machinery – Electrical equipment of machines – Part 1: General requirements', detail }),
  iec61508: (detail) => ({ title: 'IEC 61508, Functional safety of electrical/electronic/programmable electronic safety-related systems', detail }),
  iec62061: (detail) => ({ title: 'IEC 62061, Safety of machinery – Functional safety of safety-related control systems', detail }),
  isa88: (detail) => ({ title: 'ANSI/ISA-88.00.01, Batch Control Part 1: Models and Terminology', detail }),
  isa95: (detail) => ({ title: 'ANSI/ISA-95.00.01, Enterprise-Control System Integration Part 1: Models and Terminology', detail }),
  namur43: { title: 'NAMUR NE 43, Standardization of the signal level for the failure information of digital transmitters' },
  siemensAnalog: (detail) => ({ title: 'Siemens, SIMATIC S7-1500 / ET 200MP Function Manual: Analog value processing', detail }),
  siemensGuide: (detail) => ({ title: 'Siemens, Programming Guideline for S7-1200/S7-1500', detail }),
  tiaHelp: (detail) => ({ title: 'Siemens TIA Portal (STEP 7) information system', detail }),
};
