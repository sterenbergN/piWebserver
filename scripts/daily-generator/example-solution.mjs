// A model question for how solutions should read: the working, then what the
// numbers mean, then how you'd use them on a real loop, with computed diagrams
// and an interactive simulator.
// INSTRUCTIONS.md points here. Build it on its own to check it:
//   node scripts/daily-generator/build.mjs scripts/daily-generator/example-solution.mjs
// (run from a scratch folder: it writes ./daily-packs/practice-<today>.json).

import { num, fig, plot, step2, widget, SRC } from './helpers.mjs';

const R = String.raw;

// The numbers, computed once and used everywhere (text, answers, figures).
const wn = 5;
const zeta = 0.4;
const wd = wn * Math.sqrt(1 - zeta ** 2); // 4.583
const sigma = zeta * wn; // 2
const os = Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta ** 2)); // 0.2538
const tp = Math.PI / wd; // 0.6855
const tr = (Math.PI - Math.acos(zeta)) / wd; // 0.4326 (0 → 100 %)
const ts = 4 / sigma; // 2.0
const r = (v, d = 3) => Number(v.toFixed(d));

const response = plot({
  x: { min: 0, max: 4, label: 'Time t (s)' },
  y: { min: 0, max: 1.4, label: 'Output y' },
  series: [{ fn: step2(zeta, wn), label: 'Step response y(t)' }],
  hlines: [{ y: 1, label: 'Setpoint 1.0' }],
  bands: [{ from: 0.98, to: 1.02, label: '±2 % band' }],
  vlines: [{ x: tp, label: `tp = ${r(tp, 2)} s` }, { x: ts, label: `ts ≈ ${ts} s` }],
  marks: [{ x: tp, y: 1 + os, label: `Peak ${r(1 + os, 3)} (${r(os * 100, 1)} % over)` }, { x: tr, y: 1, label: `tr = ${r(tr, 2)} s` }],
});

const family = plot({
  x: { min: 0, max: 4, label: 'Time t (s)' },
  y: { min: 0, max: 1.6, label: 'Output y' },
  series: [0.2, 0.4, 0.7, 1].map((z) => ({ fn: step2(z, wn), label: `ζ = ${z}${z === zeta ? ' (this loop)' : ''}` })),
  hlines: [{ y: 1 }],
});

const circle = Array.from({ length: 121 }, (_, k) => {
  const a = Math.PI / 2 + (Math.PI * k) / 120;
  return [wn * Math.cos(a), wn * Math.sin(a)];
});
const poles = plot({
  width: 440,
  height: 400,
  x: { min: -6, max: 1, label: 'Real part σ (1/s)' },
  y: { min: -6, max: 6, label: 'Imaginary part ω (rad/s)' },
  zeroAxes: true,
  equalAspect: true,
  series: [
    { points: circle, label: `|s| = ωn = ${wn}`, dash: true, color: '#6b7280' },
    { points: [[0, 0], [-sigma * 1.4, wd * 1.4]], label: `ζ = ${zeta} line`, color: '#d95926' },
    { points: [[0, 0], [-sigma * 1.4, -wd * 1.4]], color: '#d95926' },
  ],
  marks: [
    { x: -sigma, y: wd, shape: 'x', label: `−${sigma} + j${r(wd, 2)}` },
    { x: -sigma, y: -wd, shape: 'x', label: `−${sigma} − j${r(wd, 2)}` },
  ],
});

export const practice = {
  formulas: [
    { id: 'second-order', name: 'Standard second-order system', latex: R`T(s)=\dfrac{\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}`, source: 'Nise, Control Systems Engineering, Ch. 4 (Time Response)' },
    { id: 'overshoot', name: 'Percent overshoot and peak time', latex: R`\%OS = 100\,e^{-\zeta\pi/\sqrt{1-\zeta^2}},\quad T_p=\dfrac{\pi}{\omega_n\sqrt{1-\zeta^2}}`, source: 'Nise, Control Systems Engineering, Ch. 4 (Time Response)' },
  ],
  questions: [
    {
      id: 'example-second-order-step',
      track: 'controls',
      topic: 'Time response',
      difficulty: 2,
      title: 'Read the step response off the transfer function',
      prompt: R`A closed loop has the transfer function

$$T(s)=\dfrac{25}{s^2+4s+25}$$

A unit step is applied.`,
      parts: [
        num('a', zeta, '', { prompt: R`Damping ratio $\zeta$`, mistakes: [
          { value: 0.8, note: R`That's $4/5$: the $s$ coefficient is $2\zeta\omega_n$, so divide by $2\omega_n = 10$, not $\omega_n$.` },
          { value: 0.16, note: R`That's $4/25$: compare with $s^2+2\zeta\omega_n s+\omega_n^2$, where $\omega_n=\sqrt{25}=5$, not 25.` },
        ] }),
        num('b', r(os * 100, 2), '%', { prompt: 'Percent overshoot', mistakes: [
          { value: r(100 * Math.exp(-0.8 * Math.PI / 0.6), 2), note: R`That's the overshoot for $\zeta=0.8$: check $\zeta$ first.` },
          { value: r(100 * Math.exp(-zeta * Math.PI), 2), note: R`The exponent is $-\zeta\pi/\sqrt{1-\zeta^2}$; the square root was left out.` },
        ] }),
        num('c', r(tp, 3), 's', { prompt: R`Peak time $T_p$`, mistakes: [
          { value: r(Math.PI / wn, 3), note: R`That's $\pi/\omega_n$. The system rings at the damped frequency $\omega_d=\omega_n\sqrt{1-\zeta^2}$, so $T_p=\pi/\omega_d$.` },
          { value: r(2 * tp, 3), note: R`That's a full ringing period $2\pi/\omega_d$; the first peak comes after half of one.` },
        ] }),
        num('d', ts, 's', { prompt: R`Settling time $T_s$ (2 % criterion)`, mistakes: [
          { value: 4 / wn, note: R`That's $4/\omega_n$. The decay rate is the real part of the poles, $\zeta\omega_n=2$, so $T_s\approx 4/(\zeta\omega_n)$.` },
        ] }),
      ],
      hints: [
        R`Match the denominator to $s^2+2\zeta\omega_n s+\omega_n^2$: first $\omega_n$, then $\zeta$.`,
        R`Overshoot and peak time only need $\zeta$ and $\omega_n$; settling time only needs $\zeta\omega_n$.`,
      ],
      solution: R`#### Working

Match the denominator to the standard form $s^2+2\zeta\omega_n s+\omega_n^2$:

$$\omega_n^2 = 25 \Rightarrow \omega_n = 5\ \text{rad/s},\qquad 2\zeta\omega_n = 4 \Rightarrow \zeta = \dfrac{4}{2(5)} = 0.4$$

The poles are $s=-\zeta\omega_n \pm j\omega_n\sqrt{1-\zeta^2} = -2 \pm j${r(wd, 3)}$, so the damped frequency is $\omega_d = ${r(wd, 3)}\ \text{rad/s}$.

$$\%OS = 100\,e^{-0.4\pi/\sqrt{1-0.16}} = 100\,e^{-1.371} = ${r(os * 100, 2)}\,\%$$

$$T_p = \dfrac{\pi}{\omega_d} = \dfrac{\pi}{${r(wd, 3)}} = ${r(tp, 3)}\ \text{s},\qquad T_s \approx \dfrac{4}{\zeta\omega_n} = \dfrac{4}{2} = ${ts}\ \text{s}$$

**Check:** $T(0) = 25/25 = 1$, so the output settles exactly on the setpoint (no steady-state error), and it peaks at $1+${r(os, 4)} = ${r(1 + os, 3)}$.

![](figure:response)

#### What the numbers tell you

| Quantity | This loop | What it tells you |
|---|---:|---|
| $\omega_n$ | 5 rad/s | How fast the loop wants to move: the "stiffness". |
| $\zeta$ | 0.4 | How much braking there is. Below 1 it overshoots and rings; 1 is the fastest with no overshoot; above 1 is sluggish. |
| $\omega_d$ | ${r(wd, 2)} rad/s | The frequency you actually see ringing: peaks $2\pi/\omega_d = ${r(2 * tp, 2)}$ s apart on a trend. |
| $\zeta\omega_n$ | 2 /s | The real part of the poles: how fast the ringing dies away. It alone sets $T_s$. |
| $\%OS$ | ${r(os * 100, 1)} % | How far past the setpoint it goes. Depends only on $\zeta$. |
| $T_p$ | ${r(tp, 2)} s | When the worst case happens. |

The overshoot depends only on $\zeta$: every loop with $\zeta = 0.4$ overshoots by about 25 %, however fast it is. The plot below shows the same $\omega_n$ with different damping:

![](figure:family)

On the s-plane, $\omega_n$ is the distance of the poles from the origin and $\zeta$ is the cosine of their angle from the negative real axis. Poles further left settle faster; poles at a steeper angle ring more.

![](figure:poles)

Try it below. Drag $\omega_n$ and the curve only stretches or squeezes in time: the overshoot doesn't move. Drag $\zeta$ and the overshoot changes, and so does the settling time, because $\zeta\omega_n$ changes with it.

![](widget:explore)

#### On a real loop

This $T(s)$ is what you get from a P controller with gain $K_p = 25$ on a plant $1/[s(s+4)]$ (a motor position loop, say): the closed loop is $K_p/(s^2+4s+K_p)$. So $\omega_n=\sqrt{K_p}$ and $\zeta = 2/\sqrt{K_p}$, which explains the usual tuning trade-off:

- **More gain** raises $\omega_n$ (faster rise) but lowers $\zeta$ (more overshoot). The real part stays at $-2$, so $T_s\approx 2$ s **whatever $K_p$ is**: turning up P-only gain on this plant never makes it settle sooner, it only rings more.
- **To get $\zeta = 0.7$** (about 4.6 % overshoot, a common target), set $2/\sqrt{K_p}=0.7$, so $K_p\approx 8.2$. It peaks later ($T_p\approx 1.5$ s) but barely overshoots.
- **To settle faster** you have to move the poles left, which takes derivative action (or a faster actuator), not more P.

Reading it backwards is how you commission a loop: bump the setpoint, read the overshoot and the time between peaks off the trend, and recover $\zeta = -\ln(OS)\,/\sqrt{\pi^2+\ln^2(OS)}$ (here $0.254 \to 0.40$) and $\omega_d = 2\pi/\text{period}$. Then you know which way to move the gains.

Why it matters: commanding 100 psi on a pressure loop with this response peaks at about 125 psi, enough to lift a relief valve set at 120. And a sequence that waits for the value to be "in position" can't step on until about $T_s$.

**Caveat:** these formulas are exact only for a pure second-order loop with no zeros. A PI or PID controller adds a zero, which usually adds overshoot, and actuators that saturate behave differently again. Use them for the first estimate, then check on a real trend.`,
      solutionFigures: [
        fig('response', response, `Step response of the loop: it rises to 1.0 at ${r(tr, 2)} s, peaks at ${r(1 + os, 3)} at ${r(tp, 2)} s, rings, and stays inside the ±2 % band from about ${ts} s.`, 'The step response with the answers marked.'),
        fig('family', family, 'Step responses with ωn = 5 rad/s and ζ = 0.2, 0.4, 0.7 and 1: lower ζ overshoots and rings more; ζ = 1 rises slowest with no overshoot.', 'Same ωn, different damping.'),
        fig('poles', poles, `s-plane: the poles at −${sigma} ± j${r(wd, 2)} sit on a circle of radius ωn = 5, on lines at angle arccos(0.4) ≈ 66° from the negative real axis.`, 'The closed-loop poles on the s-plane.'),
      ],
      solutionWidgets: [widget('explore', 'step2', { zeta, wn }, { caption: 'Start from this loop (ζ = 0.4, ωn = 5 rad/s); the dashed curve stays put so you can compare.' })],
      sources: [SRC.nise('Ch. 4, Time Response: second-order systems'), SRC.ogata('Ch. 5, Transient and Steady-State Response Analyses')],
      formulas: ['second-order', 'overshoot'],
    },
  ],
};
