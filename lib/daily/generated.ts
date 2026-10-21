// Practice questions made on the spot: each generator is a worked problem
// with fresh numbers every time, so Practice never runs out. A question's id
// says which generator and which seed made it ("gen-beam-reaction-k3x9"), so
// the server can rebuild exactly the same question to grade it. Answers and
// the "common slip" values are computed, never typed in.
//
// Client-safe (no server imports): the practice page lists the generators.

import type { Formula, Part, Question, Source, Track } from './types';

const R = String.raw;

/** A small seeded random source (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    /** A multiple of `step` from lo to hi. */
    step: (lo: number, hi: number, step: number) => Math.round((lo + Math.floor(next() * (Math.round((hi - lo) / step) + 1)) * step) * 1e6) / 1e6,
  };
}
type Rand = ReturnType<typeof rng>;

/** A tidy number for prompts and solutions: up to `digits` decimals, no trailing zeros. */
const f = (n: number, digits = 3) => {
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 0 : abs >= 100 ? Math.min(digits, 1) : abs >= 10 ? Math.min(digits, 2) : digits;
  return String(Number(n.toFixed(d)));
};
/** Keep 4 significant figures in an answer key. */
const sig = (n: number) => Number(n.toPrecision(4));

type Made = {
  prompt: string;
  parts: Part[];
  hints: string[];
  solution: string;
  sources: Source[];
  formulas: Formula[];
};
export type Generator = { key: string; track: Track; topic: string; difficulty: number; title: string; make: (r: Rand) => Made };

const num = (id: string, prompt: string, value: number, unit: string, mistakes: { value: number; note: string }[] = [], extra: { tolerance?: number; abs?: number } = {}): Part => ({
  id, prompt, answer: { type: 'numeric', value: sig(value), ...(unit ? { unit } : {}), ...extra },
  // Only keep slips that land clearly outside the tolerance, so a wrong method can never pass.
  ...(mistakes.length ? { mistakes: mistakes.filter((m) => Math.abs(m.value - value) > 0.05 * Math.abs(value)).map((m) => ({ value: sig(m.value), note: m.note })) } : {}),
});
const FE = (detail: string): Source => ({ title: 'NCEES FE Reference Handbook', detail });

export const GENERATORS: Generator[] = [
  /* ── Mechanical ─────────────────────────────────────────────────────── */
  {
    key: 'beam-reaction', track: 'mechanical', topic: 'Statics', difficulty: 2, title: 'Simply supported beam reactions',
    make: (r) => {
      const L = r.pick([4, 5, 6, 8, 10]);
      let a = r.step(1, L - 1, 0.5);
      if (a === L / 2) a += 0.5;
      const P = r.pick([8, 10, 12, 15, 20, 25, 30]);
      const RA = (P * (L - a)) / L;
      const RB = (P * a) / L;
      return {
        prompt: R`A simply supported beam spans $L = ${f(L)}\,\text{m}$ between pin A (left) and roller B (right). A point load $P = ${f(P)}\,\text{kN}$ acts downward ${f(a)} m from A. Ignore the beam's weight.`,
        parts: [
          num('a', 'Reaction at A', RA, 'kN', [{ value: RB, note: 'That is the reaction at B: the support nearer the load carries more of it.' }]),
          num('b', 'Reaction at B', RB, 'kN', [{ value: RA, note: 'That is the reaction at A — the reactions are swapped.' }]),
        ],
        hints: ['Take moments about one support so the other reaction is the only unknown.', 'Then use the sum of vertical forces for the second reaction.'],
        solution: R`Moments about B (counter-clockwise positive):
$$R_A \cdot ${f(L)} - ${f(P)} \cdot (${f(L)} - ${f(a)}) = 0 \;\Rightarrow\; R_A = \frac{${f(P)} \cdot ${f(L - a)}}{${f(L)}} = ${f(RA)}\,\text{kN}$$
Vertical forces: $R_B = P - R_A = ${f(P)} - ${f(RA)} = ${f(RB)}\,\text{kN}$.

**Check:** moments about A: $R_B \cdot ${f(L)} = ${f(P)} \cdot ${f(a)}$ gives the same ${f(RB)} kN. The support nearer the load carries more of it.`,
        sources: [{ title: 'Hibbeler, Engineering Mechanics: Statics', detail: 'Equilibrium of a Rigid Body' }, FE('Statics')],
        formulas: [{ id: 'equilibrium', name: 'Equilibrium', latex: R`\sum F_y = 0,\quad \sum M = 0`, source: 'NCEES FE Reference Handbook, Statics' }],
      };
    },
  },
  {
    key: 'axial-rod', track: 'mechanical', topic: 'Mechanics of materials', difficulty: 2, title: 'Stress and stretch in a rod',
    make: (r) => {
      const mat = r.pick([{ name: 'steel', E: 200 }, { name: 'aluminium', E: 70 }] as const);
      const d = r.pick([10, 12, 16, 20, 25]);
      const L = r.pick([0.5, 1, 1.5, 2, 3]);
      const F = r.pick([10, 15, 20, 25, 30, 40]);
      const A = (Math.PI * d * d) / 4;
      const sigma = (F * 1000) / A;
      const delta = (F * 1000 * L * 1000) / (A * mat.E * 1000);
      return {
        prompt: R`A solid round ${mat.name} rod, $d = ${d}\,\text{mm}$ and $L = ${f(L)}\,\text{m}$ long, carries an axial tensile load of $${F}\,\text{kN}$. Take $E = ${mat.E}\,\text{GPa}$.`,
        parts: [
          num('a', 'Normal stress in the rod', sigma, 'MPa', [{ value: sigma / 4, note: 'You used $\\pi d^2$ for the area; it is $\\pi d^2/4$ (or $\\pi r^2$).' }]),
          num('b', 'Elongation of the rod', delta, 'mm', [{ value: delta / 4, note: 'Area slip again: $A = \\pi d^2/4$.' }, { value: delta * 1000, note: 'Check units: with N, mm and MPa the elongation comes out in mm — E in GPa is 1000 MPa.' }]),
        ],
        hints: ['Area first: $A = \\pi d^2/4$.', 'Work in N, mm and MPa (N/mm²) so the units take care of themselves.'],
        solution: R`Area: $A = \pi d^2/4 = \pi (${d})^2/4 = ${f(A)}\,\text{mm}^2$.

Stress: $\sigma = F/A = ${F * 1000}\,\text{N} / ${f(A)}\,\text{mm}^2 = ${f(sigma)}\,\text{MPa}$.

Elongation:
$$\delta = \frac{FL}{AE} = \frac{${F * 1000} \cdot ${L * 1000}}{${f(A)} \cdot ${mat.E * 1000}} = ${f(delta)}\,\text{mm}$$

**Check:** strain $\varepsilon = \sigma/E = ${f(sigma / (mat.E * 1000), 6)}$, times ${L * 1000} mm is the same ${f(delta)} mm. Well under yield for ${mat.name}, so Hooke's law applies.`,
        sources: [{ title: 'Hibbeler, Mechanics of Materials', detail: 'Axial Load' }, FE('Mechanics of Materials: uniaxial loading and deformation')],
        formulas: [{ id: 'axial', name: 'Axial stress and deformation', latex: R`\sigma = \frac{F}{A},\qquad \delta = \frac{FL}{AE}`, source: 'NCEES FE Reference Handbook, Mechanics of Materials' }],
      };
    },
  },
  {
    key: 'shaft-torsion', track: 'mechanical', topic: 'Mechanics of materials', difficulty: 3, title: 'Shear stress in a shaft',
    make: (r) => {
      const T = r.pick([200, 300, 450, 600, 800, 1000, 1200]);
      const d = r.pick([25, 30, 35, 40, 45, 50]);
      const tau = (16 * T * 1000) / (Math.PI * d ** 3);
      const J = (Math.PI * d ** 4) / 32;
      return {
        prompt: R`A solid circular steel shaft of diameter $${d}\,\text{mm}$ transmits a torque of $${T}\,\text{N·m}$. Find the maximum shear stress.`,
        parts: [num('a', 'Maximum shear stress', tau, 'MPa', [
          { value: tau * 2, note: 'In $\\tau = Tc/J$, $c$ is the radius, not the diameter.' },
          { value: tau / 1000, note: 'Convert the torque to N·mm when the diameter is in mm.' },
        ])],
        hints: ['Use $\\tau = Tc/J$ with $J = \\pi d^4/32$.', 'The outer fibre is at $c = d/2$, which simplifies to $\\tau = 16T/(\\pi d^3)$.'],
        solution: R`Polar moment: $J = \pi d^4/32 = \pi (${d})^4/32 = ${f(J)}\,\text{mm}^4$, and $c = d/2 = ${d / 2}\,\text{mm}$.
$$\tau_{max} = \frac{Tc}{J} = \frac{${T * 1000} \cdot ${d / 2}}{${f(J)}} = ${f(tau)}\,\text{MPa}$$
**Check:** $16T/(\pi d^3) = 16 \cdot ${T * 1000}/(\pi \cdot ${d}^3) = ${f(tau)}$ MPa. Doubling the diameter would cut the stress by 8×.`,
        sources: [{ title: 'Hibbeler, Mechanics of Materials', detail: 'Torsion' }, FE('Mechanics of Materials: torsion')],
        formulas: [{ id: 'torsion', name: 'Torsional shear stress', latex: R`\tau = \frac{Tc}{J},\quad J = \frac{\pi d^4}{32}`, source: 'NCEES FE Reference Handbook, Mechanics of Materials' }],
      };
    },
  },
  {
    key: 'power-torque', track: 'mechanical', topic: 'Machine design', difficulty: 1, title: 'Motor torque from power and speed',
    make: (r) => {
      const P = r.pick([2.2, 4, 5.5, 7.5, 11, 15, 22]);
      const n = r.pick([960, 1450, 1750, 2900]);
      const w = (2 * Math.PI * n) / 60;
      const T = (P * 1000) / w;
      return {
        prompt: R`A ${P} kW motor runs at its rated speed of ${n} rpm. What torque does it deliver at the shaft?`,
        parts: [num('a', 'Shaft torque', T, 'N·m', [
          { value: (P * 1000) / (n / 60), note: 'Speed must be in rad/s: multiply rev/s by $2\\pi$.' },
          { value: (P * 1000) / n, note: 'rpm is not an angular velocity — convert to rad/s ($\\omega = 2\\pi n/60$).' },
        ])],
        hints: ['$P = T\\omega$, with $\\omega$ in rad/s.'],
        solution: R`$\omega = 2\pi n/60 = 2\pi \cdot ${n}/60 = ${f(w)}\,\text{rad/s}$.
$$T = \frac{P}{\omega} = \frac{${P * 1000}}{${f(w)}} = ${f(T)}\,\text{N·m}$$
**Check:** the shortcut $T = 9549\,P[\text{kW}]/n[\text{rpm}] = ${f((9549 * P) / n)}$ N·m. Slower motors of the same power give more torque — that's what gearboxes trade on.`,
        sources: [{ title: "Shigley's Mechanical Engineering Design", detail: 'Shafts and Shaft Components' }, FE('Dynamics: work, energy and power')],
        formulas: [{ id: 'power', name: 'Rotational power', latex: R`P = T\omega,\quad \omega = \frac{2\pi n}{60}`, source: 'NCEES FE Reference Handbook, Dynamics' }],
      };
    },
  },
  {
    key: 'pipe-flow', track: 'mechanical', topic: 'Fluid mechanics', difficulty: 2, title: 'Velocity and Reynolds number in a pipe',
    make: (r) => {
      let D = 50, Q = 5, V = 0;
      for (let i = 0; i < 50; i++) {
        D = r.pick([25, 40, 50, 65, 80, 100]);
        Q = r.pick([1, 2, 3, 5, 8, 10, 15, 20]);
        V = (Q / 1000) / ((Math.PI * (D / 1000) ** 2) / 4);
        if (V >= 0.5 && V <= 4) break;
      }
      const Re = (V * (D / 1000)) / 1e-6;
      const regime = Re < 2300 ? 0 : Re < 4000 ? 1 : 2;
      return {
        prompt: R`Water ($\nu = 1.0 \times 10^{-6}\,\text{m}^2/\text{s}$) flows at $${Q}\,\text{L/s}$ through a pipe with an inside diameter of $${D}\,\text{mm}$.`,
        parts: [
          num('a', 'Average velocity', V, 'm/s', [{ value: V / 4, note: 'Pipe area is $\\pi D^2/4$, not $\\pi D^2$.' }, { value: V * 4, note: 'You used the diameter as the radius in $\\pi r^2$.' }]),
          num('b', 'Reynolds number', Re, '', [{ value: Re / 4, note: 'Carry the correct velocity through: area slip in part (a).' }]),
          { id: 'c', prompt: 'The flow is…', answer: { type: 'choice', options: ['Laminar (Re < 2300)', 'Transitional', 'Turbulent (Re > 4000)'], correct: regime } },
        ],
        hints: ['$V = Q/A$ with $Q$ in m³/s (1 L = 0.001 m³).', '$Re = VD/\\nu$.'],
        solution: R`$A = \pi D^2/4 = \pi (${D / 1000})^2/4 = ${f((Math.PI * (D / 1000) ** 2) / 4, 6)}\,\text{m}^2$, $Q = ${Q / 1000}\,\text{m}^3/\text{s}$.

$V = Q/A = ${f(V)}\,\text{m/s}$.
$$Re = \frac{VD}{\nu} = \frac{${f(V)} \cdot ${D / 1000}}{1.0\times 10^{-6}} = ${f(Re, 0)}$$
That is **${['laminar', 'transitional', 'turbulent'][regime]}**. Water in real pipes is almost always turbulent; laminar flow needs very slow flow or a thick fluid.`,
        sources: [{ title: 'Munson, Fundamentals of Fluid Mechanics', detail: 'Viscous Flow in Pipes' }, FE('Fluid Mechanics: Reynolds number')],
        formulas: [{ id: 'reynolds', name: 'Continuity and Reynolds number', latex: R`V = \frac{Q}{A},\quad Re = \frac{VD}{\nu}`, source: 'NCEES FE Reference Handbook, Fluid Mechanics' }],
      };
    },
  },
  {
    key: 'water-heating', track: 'mechanical', topic: 'Thermodynamics', difficulty: 1, title: 'Heating water with an element',
    make: (r) => {
      const m = r.pick([2, 5, 10, 20, 50]);
      const T1 = r.pick([10, 15, 20]);
      const T2 = r.pick([40, 50, 60, 80]);
      const P = r.pick([1.5, 2, 3, 6]);
      const Q = m * 4.18 * (T2 - T1);
      const t = Q / P / 60;
      return {
        prompt: R`A tank holds ${m} kg of water at ${T1} °C. A ${P} kW immersion heater warms it to ${T2} °C. Take $c_p = 4.18\,\text{kJ/kg·K}$ and ignore heat losses.`,
        parts: [
          num('a', 'Heat needed', Q, 'kJ', [{ value: m * 4.18 * T2, note: 'Use the temperature rise, $T_2 - T_1$, not the final temperature.' }]),
          num('b', 'Heating time', t, 'min', [{ value: Q / P, note: 'That is in seconds: kJ ÷ kW = s. Divide by 60.' }]),
        ],
        hints: ['$Q = m c_p \\Delta T$.', 'Time = energy ÷ power; kJ ÷ kW gives seconds.'],
        solution: R`$$Q = m c_p (T_2 - T_1) = ${m} \cdot 4.18 \cdot (${T2} - ${T1}) = ${f(Q)}\,\text{kJ}$$
$t = Q/P = ${f(Q)}/${P} = ${f(Q / P)}\,\text{s} = ${f(t)}\,\text{min}$.

In practice losses from the tank make it take longer; this is the minimum.`,
        sources: [{ title: 'Çengel & Boles, Thermodynamics: An Engineering Approach', detail: 'Energy Analysis of Closed Systems' }],
        formulas: [{ id: 'sensible', name: 'Sensible heat', latex: R`Q = m c_p \Delta T,\quad t = \frac{Q}{P}`, source: 'Çengel & Boles, Thermodynamics' }],
      };
    },
  },
  {
    key: 'wall-conduction', track: 'mechanical', topic: 'Heat transfer', difficulty: 2, title: 'Heat loss through a wall',
    make: (r) => {
      const mat = r.pick([{ name: 'brick', k: 0.7 }, { name: 'concrete', k: 1.4 }, { name: 'softwood', k: 0.12 }, { name: 'glass', k: 0.96 }] as const);
      const A = r.pick([4, 6, 8, 10, 12, 15]);
      const t = r.pick([50, 100, 150, 200]);
      const Ti = r.pick([20, 21, 22]);
      const To = r.pick([-10, -5, 0, 5]);
      const q = (mat.k * A * (Ti - To)) / (t / 1000);
      return {
        prompt: R`A ${mat.name} wall ($k = ${mat.k}\,\text{W/m·K}$) is ${t} mm thick with an area of ${A} m². The inside surface is at ${Ti} °C and the outside surface at ${To} °C. Find the steady heat loss by conduction.`,
        parts: [num('a', 'Heat loss', q, 'W', [
          { value: (mat.k * A * (Ti - To)) / t, note: `Thickness must be in metres: ${t} mm = ${t / 1000} m.` },
          { value: (mat.k * A * (Ti + To)) / (t / 1000), note: 'Use the temperature difference, $T_i - T_o$ (watch the sign of a negative outside temperature).' },
        ])],
        hints: ['Fourier\'s law for a plane wall: $q = kA\\,\\Delta T/L$.'],
        solution: R`$$q = \frac{kA(T_i - T_o)}{L} = \frac{${mat.k} \cdot ${A} \cdot (${Ti} - (${To}))}{${t / 1000}} = ${f(q)}\,\text{W}$$
The thermal resistance is $L/(kA) = ${f(t / 1000 / (mat.k * A), 5)}\,\text{K/W}$; doubling the thickness halves the loss.`,
        sources: [{ title: 'Incropera, Fundamentals of Heat and Mass Transfer', detail: 'One-Dimensional, Steady-State Conduction' }, FE('Heat Transfer: conduction')],
        formulas: [{ id: 'fourier', name: "Fourier's law (plane wall)", latex: R`q = \frac{kA\,\Delta T}{L}`, source: 'NCEES FE Reference Handbook, Heat Transfer' }],
      };
    },
  },
  {
    key: 'stopping-distance', track: 'mechanical', topic: 'Dynamics', difficulty: 2, title: 'Stopping distance',
    make: (r) => {
      const v = r.pick([36, 54, 72, 90, 108]);
      const a = r.pick([4, 5, 6, 7]);
      const tr = r.pick([0.75, 1, 1.5]);
      const ms = v / 3.6;
      const brake = (ms * ms) / (2 * a);
      const total = ms * tr + brake;
      return {
        prompt: R`A vehicle travelling at ${v} km/h brakes with a constant deceleration of $${a}\,\text{m/s}^2$. The driver's reaction time is ${tr} s.`,
        parts: [
          num('a', 'Braking distance (after the brakes are applied)', brake, 'm', [{ value: (v * v) / (2 * a), note: 'Convert km/h to m/s first (÷ 3.6).' }]),
          num('b', 'Total stopping distance, including reaction', total, 'm', [{ value: brake, note: 'Add the distance covered during the reaction time, at full speed.' }]),
        ],
        hints: ['$v^2 = v_0^2 - 2as$ with $v = 0$.', 'During the reaction time the speed is still $v_0$.'],
        solution: R`$v_0 = ${v}/3.6 = ${f(ms)}\,\text{m/s}$.
$$s_{brake} = \frac{v_0^2}{2a} = \frac{${f(ms)}^2}{2 \cdot ${a}} = ${f(brake)}\,\text{m}$$
Reaction: $s_r = v_0 t_r = ${f(ms)} \cdot ${tr} = ${f(ms * tr)}\,\text{m}$, so the total is $${f(total)}\,\text{m}$.

Braking distance goes with the square of speed: double the speed, four times the braking distance.`,
        sources: [{ title: 'Hibbeler, Engineering Mechanics: Dynamics', detail: 'Kinematics of a Particle' }, FE('Dynamics: constant acceleration')],
        formulas: [{ id: 'kinematics', name: 'Constant acceleration', latex: R`v^2 = v_0^2 + 2a s`, source: 'NCEES FE Reference Handbook, Dynamics' }],
      };
    },
  },
  {
    key: 'loan-payment', track: 'mechanical', topic: 'Engineering economics', difficulty: 2, title: 'Annual payment on a loan',
    make: (r) => {
      const P = r.pick([10000, 15000, 20000, 25000, 40000, 60000]);
      const i = r.pick([4, 5, 6, 8, 10]);
      const n = r.pick([3, 5, 7, 10]);
      const g = (1 + i / 100) ** n;
      const A = (P * (i / 100) * g) / (g - 1);
      return {
        prompt: R`A machine costing \$${P.toLocaleString('en-US')} is paid for with a loan at ${i} % per year, repaid in ${n} equal end-of-year payments.`,
        parts: [num('a', 'Annual payment', A, 'USD/yr', [
          { value: (P * (1 + (n * i) / 100)) / n, note: 'That is simple interest. Loans compound: use the capital recovery factor (A/P, i, n).' },
          { value: P / n, note: 'That leaves out interest altogether.' },
        ])],
        hints: ['Capital recovery factor: $(A/P, i, n) = \\dfrac{i(1+i)^n}{(1+i)^n - 1}$.'],
        solution: R`$(1+i)^n = 1.${String(i).padStart(2, '0')}^{${n}} = ${f(g, 5)}$.
$$A = P\,\frac{i(1+i)^n}{(1+i)^n - 1} = ${P} \cdot \frac{${i / 100} \cdot ${f(g, 5)}}{${f(g - 1, 5)}} = ${f(A, 2)}\ \text{per year}$$
That is \$${f(A, 2)} a year. Total repaid: ${n} × \$${f(A, 2)} = \$${f(A * n, 0)}, so the interest costs \$${f(A * n - P, 0)}.`,
        sources: [{ title: 'Newnan, Engineering Economic Analysis', detail: 'Interest and Equivalence' }, FE('Engineering Economics: factor table')],
        formulas: [{ id: 'crf', name: 'Capital recovery factor', latex: R`(A/P, i, n) = \frac{i(1+i)^n}{(1+i)^n - 1}`, source: 'NCEES FE Reference Handbook, Engineering Economics' }],
      };
    },
  },
  {
    key: 'rc-charging', track: 'mechanical', topic: 'Circuits', difficulty: 2, title: 'Charging a capacitor',
    make: (r) => {
      const Vs = r.pick([5, 9, 12, 24]);
      const Rk = r.pick([1, 2.2, 4.7, 10]);
      const C = r.pick([10, 22, 47, 100]);
      const tau = Rk * C; // kΩ × µF = ms
      const mult = r.pick([0.5, 1, 1.5, 2, 3]);
      const t = sig(tau * mult);
      const V = Vs * (1 - Math.exp(-t / tau));
      return {
        prompt: R`A ${Rk} kΩ resistor and an initially uncharged ${C} µF capacitor are switched in series across a ${Vs} V DC supply at $t = 0$.`,
        parts: [
          num('a', 'Time constant', tau, 'ms', [{ value: tau / 1000, note: 'kΩ × µF gives milliseconds.' }]),
          num('b', `Capacitor voltage at t = ${f(t)} ms`, V, 'V', [{ value: Vs * Math.exp(-t / tau), note: 'That is a discharging curve; charging is $V_s(1 - e^{-t/\\tau})$.' }]),
        ],
        hints: ['$\\tau = RC$.', 'Charging: $v_C(t) = V_s\\,(1 - e^{-t/\\tau})$.'],
        solution: R`$\tau = RC = ${Rk}\,\text{k}\Omega \times ${C}\,\mu\text{F} = ${f(tau)}\,\text{ms}$.
$$v_C = V_s\left(1 - e^{-t/\tau}\right) = ${Vs}\left(1 - e^{-${f(t)}/${f(tau)}}\right) = ${f(V)}\,\text{V}$$
After one time constant a capacitor is at 63 % of the supply; after five it is effectively full.`,
        sources: [{ title: 'Nilsson & Riedel, Electric Circuits', detail: 'Response of First-Order RL and RC Circuits' }, FE('Electricity and Magnetism: RC transients')],
        formulas: [{ id: 'rc', name: 'RC charging', latex: R`v_C(t) = V_s\left(1 - e^{-t/RC}\right)`, source: 'NCEES FE Reference Handbook, Electricity and Magnetism' }],
      };
    },
  },
  {
    key: 'spring-mass', track: 'mechanical', topic: 'Vibrations', difficulty: 2, title: 'Natural frequency of a spring–mass system',
    make: (r) => {
      const k = r.pick([2, 5, 10, 20, 50, 80]);
      const m = r.pick([5, 10, 20, 50, 100]);
      const wn = Math.sqrt((k * 1000) / m);
      const fn = wn / (2 * Math.PI);
      const dst = (m * 9.81) / (k * 1000) * 1000;
      return {
        prompt: R`A ${m} kg machine sits on springs with a combined stiffness of ${k} kN/m. Treat it as an undamped single-degree-of-freedom system.`,
        parts: [
          num('a', 'Natural frequency', fn, 'Hz', [{ value: wn, note: 'That is $\\omega_n$ in rad/s; divide by $2\\pi$ for Hz.' }, { value: Math.sqrt(k / m) / (2 * Math.PI), note: 'Stiffness must be in N/m (×1000).' }]),
          num('b', 'Static deflection under its own weight', dst, 'mm'),
        ],
        hints: ['$\\omega_n = \\sqrt{k/m}$, $f_n = \\omega_n/2\\pi$.', 'Static deflection: $\\delta = mg/k$.'],
        solution: R`$\omega_n = \sqrt{k/m} = \sqrt{${k * 1000}/${m}} = ${f(wn)}\,\text{rad/s}$, so $f_n = ${f(wn)}/2\pi = ${f(fn)}\,\text{Hz}$.

$\delta_{st} = mg/k = ${m} \cdot 9.81/${k * 1000} = ${f(dst)}\,\text{mm}$.

**Check:** $f_n = \frac{1}{2\pi}\sqrt{g/\delta_{st}}$ gives the same ${f(fn)} Hz — handy when you only know how far it sags.`,
        sources: [{ title: 'Rao, Mechanical Vibrations', detail: 'Free Vibration of Single-Degree-of-Freedom Systems' }, FE('Dynamics: free vibration')],
        formulas: [{ id: 'natural-frequency', name: 'Natural frequency', latex: R`\omega_n = \sqrt{\frac{k}{m}},\quad f_n = \frac{\omega_n}{2\pi}`, source: 'NCEES FE Reference Handbook, Dynamics' }],
      };
    },
  },

  /* ── Controls ───────────────────────────────────────────────────────── */
  {
    key: 'first-order-step', track: 'controls', topic: 'Time response', difficulty: 2, title: 'First-order step response',
    make: (r) => {
      const K = r.pick([0.5, 2, 2.5, 4, 5]);
      const tau = r.pick([2, 4, 5, 8, 10]);
      const A = r.pick([1, 2, 5, 10]);
      const mult = r.pick([0.5, 1, 2, 3]);
      const t = tau * mult;
      const y = K * A * (1 - Math.exp(-t / tau));
      return {
        prompt: R`A process has the transfer function
$$G(s) = \frac{${K}}{${tau}s + 1}$$
and starts at rest. A step of size ${A} is applied to its input at $t = 0$.`,
        parts: [
          num('a', 'Final value of the output', K * A, '', [{ value: A, note: 'Multiply by the steady-state gain $K = G(0)$.' }]),
          num('b', `Output at t = ${f(t)} s`, y, '', [{ value: A * (1 - Math.exp(-t / tau)), note: 'Include the gain $K$.' }, { value: K * A * Math.exp(-t / tau), note: 'The rise is $1 - e^{-t/\\tau}$; you used the part that is still missing.' }]),
        ],
        hints: ['Final value: $K \\cdot A$.', '$y(t) = KA\\,(1 - e^{-t/\\tau})$.'],
        solution: R`Gain $K = ${K}$, time constant $\tau = ${tau}$ s.

Final value: $y(\infty) = KA = ${K} \cdot ${A} = ${f(K * A)}$.
$$y(${f(t)}) = KA\left(1 - e^{-${f(t)}/${tau}}\right) = ${f(K * A)} \cdot ${f(1 - Math.exp(-t / tau), 4)} = ${f(y)}$$
At $t = \tau$ a first-order system is at 63.2 % of its change; at $4\tau$, 98 %.`,
        sources: [{ title: 'Nise, Control Systems Engineering', detail: 'Time Response: first-order systems' }],
        formulas: [{ id: 'first-order', name: 'First-order step response', latex: R`y(t) = KA\left(1 - e^{-t/\tau}\right)`, source: 'Nise, Control Systems Engineering' }],
      };
    },
  },
  {
    key: 'second-order', track: 'controls', topic: 'Time response', difficulty: 3, title: 'Overshoot and settling time',
    make: (r) => {
      const z = r.pick([0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
      const wn = r.pick([2, 4, 5, 8, 10]);
      const os = 100 * Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
      const ts = 4 / (z * wn);
      const tp = Math.PI / (wn * Math.sqrt(1 - z * z));
      return {
        prompt: R`A closed loop behaves as the standard second-order system
$$T(s) = \frac{${wn * wn}}{s^2 + ${f(2 * z * wn)}s + ${wn * wn}}$$
Find its unit-step response characteristics.`,
        parts: [
          num('a', 'Percent overshoot', os, '%', [{ value: 100 * Math.exp(-z * Math.PI), note: 'The exponent is $-\\zeta\\pi/\\sqrt{1-\\zeta^2}$ — keep the square root.' }]),
          num('b', 'Settling time (2 % criterion)', ts, 's', [{ value: 3 / (z * wn), note: '$3/\\zeta\\omega_n$ is the 5 % criterion; 2 % uses 4.' }]),
          num('c', 'Peak time', tp, 's', [{ value: Math.PI / wn, note: 'Use the damped frequency $\\omega_d = \\omega_n\\sqrt{1-\\zeta^2}$.' }]),
        ],
        hints: ['Match the denominator to $s^2 + 2\\zeta\\omega_n s + \\omega_n^2$.', '$\\%OS = 100\\,e^{-\\zeta\\pi/\\sqrt{1-\\zeta^2}}$, $T_s \\approx 4/\\zeta\\omega_n$, $T_p = \\pi/\\omega_d$.'],
        solution: R`From the denominator: $\omega_n^2 = ${wn * wn} \Rightarrow \omega_n = ${wn}\,\text{rad/s}$, and $2\zeta\omega_n = ${f(2 * z * wn)} \Rightarrow \zeta = ${z}$.

$$\%OS = 100\,e^{-\zeta\pi/\sqrt{1-\zeta^2}} = 100\,e^{-${z}\pi/${f(Math.sqrt(1 - z * z), 4)}} = ${f(os)}\,\%$$
$T_s = 4/(\zeta\omega_n) = 4/${f(z * wn)} = ${f(ts)}\,\text{s}$.

$T_p = \pi/(\omega_n\sqrt{1-\zeta^2}) = ${f(tp)}\,\text{s}$.

Overshoot depends only on $\zeta$; speed scales with $\omega_n$.`,
        sources: [{ title: 'Nise, Control Systems Engineering', detail: 'Time Response: second-order underdamped systems' }],
        formulas: [{ id: 'second-order', name: 'Second-order step specs', latex: R`\%OS = 100\,e^{-\zeta\pi/\sqrt{1-\zeta^2}},\ T_s \approx \frac{4}{\zeta\omega_n},\ T_p = \frac{\pi}{\omega_n\sqrt{1-\zeta^2}}`, source: 'Nise, Control Systems Engineering' }],
      };
    },
  },
  {
    key: 'steady-state-error', track: 'controls', topic: 'Steady-state error', difficulty: 2, title: 'Step error of a type-0 loop',
    make: (r) => {
      const a = r.pick([1, 2, 3, 4, 5]);
      let b = r.pick([2, 4, 5, 6, 10]);
      if (b === a) b += 1;
      const K = r.pick([10, 20, 30, 40, 60, 80, 100]);
      const Kp = K / (a * b);
      const e = 100 / (1 + Kp);
      return {
        prompt: R`A unity-feedback loop has the open-loop transfer function
$$G(s) = \frac{${K}}{(s + ${a})(s + ${b})}$$
and is stable. A unit step is applied to the setpoint.`,
        parts: [
          num('a', 'Position error constant Kp', Kp, '', [{ value: K, note: '$K_p = \\lim_{s\\to 0} G(s)$: set $s = 0$ in the whole expression.' }]),
          num('b', 'Steady-state error', e, '% of the step', [{ value: 100 / Kp, note: 'For a step the error is $1/(1+K_p)$, not $1/K_p$.' }]),
        ],
        hints: ['$K_p = \\lim_{s \\to 0} G(s)$.', 'Step error of a type-0 system: $e_{ss} = 1/(1+K_p)$.'],
        solution: R`$$K_p = \lim_{s\to 0} G(s) = \frac{${K}}{${a} \cdot ${b}} = ${f(Kp)}$$
$e_{ss} = \dfrac{1}{1 + K_p} = \dfrac{1}{${f(1 + Kp)}} = ${f(e / 100, 4)}$, i.e. ${f(e)} % of the step.

A type-0 loop always leaves some offset; adding an integrator (type 1) removes it for steps.`,
        sources: [{ title: 'Nise, Control Systems Engineering', detail: 'Steady-State Errors' }],
        formulas: [{ id: 'ess-step', name: 'Step error (type 0)', latex: R`K_p = \lim_{s\to 0} G(s),\quad e_{ss} = \frac{1}{1+K_p}`, source: 'Nise, Control Systems Engineering' }],
      };
    },
  },
  {
    key: 'routh-range', track: 'controls', topic: 'Routh–Hurwitz', difficulty: 3, title: 'Range of gain for stability',
    make: (r) => {
      const a = r.pick([1, 2, 3, 4]);
      let b = r.pick([2, 3, 5, 6, 8]);
      if (b === a) b += 1;
      const Kmax = a * b * (a + b);
      const w = Math.sqrt(a * b);
      return {
        prompt: R`A unity-feedback loop has
$$G(s) = \frac{K}{s(s + ${a})(s + ${b})}$$
Its characteristic equation is $s^3 + ${a + b}s^2 + ${a * b}s + K = 0$.`,
        parts: [
          { id: 'a', prompt: 'Range of K for which the closed loop is stable', answer: { type: 'range', min: 0, max: Kmax } },
          num('b', 'Frequency of the sustained oscillation at the upper limit', w, 'rad/s', [{ value: w / (2 * Math.PI), note: 'Give it in rad/s, straight from the auxiliary equation.' }]),
        ],
        hints: ['Build the Routh array and require every first-column entry to be positive.', `At the limit, the $s^2$ row gives the auxiliary equation $${a + b}s^2 + K = 0$.`],
        solution: R`Routh array:
$$\begin{array}{c|cc} s^3 & 1 & ${a * b} \\ s^2 & ${a + b} & K \\ s^1 & \dfrac{${(a + b) * a * b} - K}{${a + b}} & \\ s^0 & K & \end{array}$$

Positive first column: $K > 0$ and $${(a + b) * a * b} - K > 0$, so **$0 < K < ${Kmax}$**.

At $K = ${Kmax}$: $${a + b}s^2 + ${Kmax} = 0 \Rightarrow s = \pm j${f(w)}$, an oscillation at $\omega = ${f(w)}$ rad/s.`,
        sources: [{ title: 'Nise, Control Systems Engineering', detail: 'Stability: Routh–Hurwitz criterion' }],
        formulas: [{ id: 'routh', name: 'Routh–Hurwitz (cubic)', latex: R`s^3 + a_2 s^2 + a_1 s + a_0:\ \text{stable} \iff a_i > 0,\ a_2 a_1 > a_0`, source: 'Nise, Control Systems Engineering' }],
      };
    },
  },
  {
    key: 'zn-tuning', track: 'controls', topic: 'PID tuning', difficulty: 2, title: 'Ziegler–Nichols PID settings',
    make: (r) => {
      const Ku = r.pick([1.5, 2, 2.4, 3, 4, 5, 8]);
      const Pu = r.pick([8, 10, 12, 20, 30, 40, 60]);
      return {
        prompt: R`In a closed-loop test with P-only control, a temperature loop oscillates steadily at a gain of $K_u = ${Ku}$ with a period of $P_u = ${Pu}\,\text{s}$. Use the classic Ziegler–Nichols ultimate-gain rules for a PID controller (ideal form).`,
        parts: [
          num('a', 'Controller gain Kc', 0.6 * Ku, '', [{ value: 0.45 * Ku, note: '0.45 Ku is the PI rule; PID uses 0.6 Ku.' }, { value: 0.5 * Ku, note: '0.5 Ku is the P-only rule.' }]),
          num('b', 'Integral time Ti', Pu / 2, 's', [{ value: Pu / 1.2, note: 'Pu/1.2 is the PI rule; PID uses Pu/2.' }]),
          num('c', 'Derivative time Td', Pu / 8, 's'),
        ],
        hints: ['Classic Z–N PID: $K_c = 0.6K_u$, $T_i = P_u/2$, $T_d = P_u/8$.'],
        solution: R`$K_c = 0.6 K_u = 0.6 \cdot ${Ku} = ${f(0.6 * Ku)}$

$T_i = P_u/2 = ${f(Pu / 2)}\,\text{s}$

$T_d = P_u/8 = ${f(Pu / 8)}\,\text{s}$

Z–N settings are aggressive (about quarter-decay); many plants are detuned from here, e.g. halving $K_c$.`,
        sources: [{ title: 'Åström & Hägglund, PID Controllers: Theory, Design, and Tuning', detail: 'Ziegler–Nichols methods' }],
        formulas: [{ id: 'zn', name: 'Ziegler–Nichols (ultimate gain), PID', latex: R`K_c = 0.6K_u,\ T_i = \frac{P_u}{2},\ T_d = \frac{P_u}{8}`, source: 'Åström & Hägglund, PID Controllers' }],
      };
    },
  },
  {
    key: 'aliasing', track: 'controls', topic: 'Digital control', difficulty: 3, title: 'Aliasing',
    make: (r) => {
      const fs = r.pick([100, 200, 250, 500, 1000]);
      let sig0 = fs, alias = 0;
      for (let i = 0; i < 50; i++) {
        sig0 = Math.round(r.step(0.55, 1.9, 0.05) * fs);
        alias = Math.abs(sig0 - Math.round(sig0 / fs) * fs);
        if (alias > 0 && alias !== fs / 2) break;
      }
      return {
        prompt: R`A ${sig0} Hz sinusoid is sampled at ${fs} Hz with no anti-aliasing filter.`,
        parts: [
          num('a', 'Nyquist frequency', fs / 2, 'Hz', [{ value: fs, note: 'Nyquist is half the sampling rate.' }]),
          num('b', 'Frequency that appears in the sampled data', alias, 'Hz', [{ value: sig0, note: 'It is above Nyquist, so it cannot appear as itself — it folds back.' }, { value: Math.abs(sig0 - fs / 2), note: 'It folds about multiples of the sampling rate: $|f - kf_s|$.' }]),
        ],
        hints: ['Nyquist: $f_s/2$.', 'Alias: $|f - k f_s|$ for the whole number $k$ that brings it into $0 \\dots f_s/2$.'],
        solution: R`Nyquist: $f_s/2 = ${fs / 2}$ Hz. The signal is above it, so it aliases.
$$f_a = |f - k f_s| = |${sig0} - ${Math.round(sig0 / fs)} \cdot ${fs}| = ${alias}\,\text{Hz}$$
The sampled data look exactly like a ${alias} Hz signal; nothing after sampling can tell them apart, which is why the filter goes before the ADC.`,
        sources: [{ title: 'Franklin, Powell & Workman, Digital Control of Dynamic Systems', detail: 'Sampled-data systems: aliasing' }],
        formulas: [{ id: 'alias', name: 'Aliased frequency', latex: R`f_N = \frac{f_s}{2},\quad f_a = |f - k f_s|`, source: 'Franklin, Powell & Workman, Digital Control of Dynamic Systems' }],
      };
    },
  },

  /* ── Automation ─────────────────────────────────────────────────────── */
  {
    key: 'analog-scaling', track: 'automation', topic: 'Analog I/O and scaling', difficulty: 2, title: 'Scaling a 4–20 mA signal',
    make: (r) => {
      const range = r.pick([
        { what: 'pressure transmitter', lo: 0, hi: 10, unit: 'bar' },
        { what: 'level transmitter', lo: 0, hi: 5, unit: 'm' },
        { what: 'temperature transmitter', lo: -50, hi: 150, unit: '°C' },
        { what: 'flow meter', lo: 0, hi: 200, unit: 'm³/h' },
      ] as const);
      let I = 12;
      for (let k = 0; k < 20 && (I === 12 || I === 4 || I === 20); k++) I = r.step(5, 19.5, 0.1);
      const value = range.lo + ((I - 4) / 16) * (range.hi - range.lo);
      const raw = Math.round(((I - 4) / 16) * 27648);
      return {
        prompt: R`A ${range.what} is ranged ${range.lo} to ${range.hi} ${range.unit} for 4–20 mA and wired to a Siemens S7-1500 analog input set to 4–20 mA (nominal range 0 to 27648). The loop current reads ${f(I)} mA.`,
        parts: [
          num('a', 'Process value', value, range.unit, [{ value: range.lo + (I / 20) * (range.hi - range.lo), note: 'The live zero is 4 mA: use $(I - 4)/16$, not $I/20$.' }], { abs: 0.002 * (range.hi - range.lo) }),
          num('b', 'Raw value the PLC sees', raw, '', [{ value: Math.round((I / 20) * 27648), note: '4 mA is raw 0 in the 4–20 mA range.' }], { abs: 2 }),
        ],
        hints: ['Fraction of span: $(I - 4\\,\\text{mA})/16\\,\\text{mA}$.', 'The raw value is that fraction of 27648.'],
        solution: R`Fraction of span: $(${f(I)} - 4)/16 = ${f((I - 4) / 16, 4)}$.

Process value: $${range.lo} + ${f((I - 4) / 16, 4)} \times (${range.hi} - (${range.lo})) = ${f(value)}$ ${range.unit}.

Raw: $${f((I - 4) / 16, 4)} \times 27648 = ${raw}$. In TIA Portal, NORM_X (0…27648 → 0.0…1.0) then SCALE_X (→ ${range.lo}…${range.hi}) does exactly this.`,
        sources: [{ title: 'Siemens S7-1500 / ET 200MP Analog Value Processing (function manual)', detail: 'Representation of analog values' }],
        formulas: [{ id: 'scaling', name: '4–20 mA scaling', latex: R`PV = PV_{lo} + \frac{I - 4}{16}\,(PV_{hi} - PV_{lo})`, source: 'Siemens analog value processing manual' }],
      };
    },
  },
  {
    key: 'motor-slip', track: 'automation', topic: 'Drives', difficulty: 2, title: 'Induction motor speed and slip',
    make: (r) => {
      const fr = r.pick([50, 60]);
      const p = r.pick([2, 4, 6]);
      const ns = (120 * fr) / p;
      const s = r.pick([2.5, 3, 3.5, 4, 4.5, 5]);
      const n = Math.round(ns * (1 - s / 100));
      const slip = ((ns - n) / ns) * 100;
      return {
        prompt: R`A ${p}-pole induction motor on a ${fr} Hz supply has a nameplate speed of ${n} rpm at full load.`,
        parts: [
          num('a', 'Synchronous speed', ns, 'rpm', [{ value: (60 * fr) / p, note: 'With poles (not pole pairs) it is $120f/p$.' }]),
          num('b', 'Full-load slip', slip, '%', [{ value: ns - n, note: 'That is the slip speed in rpm; slip is that as a % of synchronous speed.' }]),
        ],
        hints: ['$n_s = 120f/p$ with $p$ the number of poles.', 'Slip $= (n_s - n)/n_s$.'],
        solution: R`$n_s = 120 f/p = 120 \cdot ${fr}/${p} = ${ns}$ rpm.
$$s = \frac{n_s - n}{n_s} = \frac{${ns} - ${n}}{${ns}} = ${f(slip)}\,\%$$
On a VFD the synchronous speed scales with frequency, so at half frequency the motor runs at roughly half speed (minus a similar slip in rpm).`,
        sources: [{ title: 'Chapman, Electric Machinery Fundamentals', detail: 'Induction Motors' }],
        formulas: [{ id: 'sync-speed', name: 'Synchronous speed and slip', latex: R`n_s = \frac{120f}{p},\quad s = \frac{n_s - n}{n_s}`, source: 'Chapman, Electric Machinery Fundamentals' }],
      };
    },
  },
  {
    key: 'psu-budget', track: 'automation', topic: 'Electrical design', difficulty: 1, title: '24 V DC power supply sizing',
    make: (r) => {
      const cpu = r.pick([0.5, 0.7, 0.9]);
      const io = r.pick([4, 6, 8]);
      const ioI = r.pick([30, 50, 70]);
      const sensors = r.pick([10, 16, 24, 32]);
      const sensorI = r.pick([20, 25, 35]);
      const valves = r.pick([4, 8, 12]);
      const valveW = r.pick([1.5, 2.5, 4.8]);
      const total = cpu + (io * ioI) / 1000 + (sensors * sensorI) / 1000 + (valves * valveW) / 24;
      const sizes = [2.5, 5, 10, 20, 40];
      const pick = sizes.findIndex((s) => s >= total * 1.25);
      return {
        prompt: R`A 24 V DC control supply feeds: a PLC CPU drawing ${cpu} A; ${io} I/O modules at ${ioI} mA each; ${sensors} sensors at ${sensorI} mA each; and ${valves} solenoid valves rated ${valveW} W each, all on at once.`,
        parts: [
          num('a', 'Total current', total, 'A', [{ value: cpu + (io * ioI) / 1000 + (sensors * sensorI) / 1000 + valves * valveW, note: 'Convert the valves from watts to amps: $I = P/V$ at 24 V.' }]),
          { id: 'b', prompt: 'Smallest standard supply that leaves at least 25 % headroom', answer: { type: 'choice', options: sizes.map((s) => `${s} A`), correct: Math.max(0, pick) } },
        ],
        hints: ['Valve current $= P/24\\,\\text{V}$.', 'Headroom: the supply must be at least $1.25 \\times$ the total.'],
        solution: R`Valves: $${valves} \times ${valveW}/24 = ${f((valves * valveW) / 24)}$ A. I/O: $${io} \times ${ioI}\,\text{mA} = ${f((io * ioI) / 1000)}$ A. Sensors: $${sensors} \times ${sensorI}\,\text{mA} = ${f((sensors * sensorI) / 1000)}$ A.

Total: $${cpu} + ${f((io * ioI) / 1000)} + ${f((sensors * sensorI) / 1000)} + ${f((valves * valveW) / 24)} = ${f(total)}$ A.

With 25 % headroom: $${f(total * 1.25)}$ A → the **${sizes[Math.max(0, pick)]} A** supply. Headroom covers inrush, ageing and the next sensor someone adds.`,
        sources: [{ title: 'IEC 60204-1, Safety of machinery — Electrical equipment of machines', detail: 'Control circuits and control functions' }],
        formulas: [{ id: 'dc-power', name: 'DC current from power', latex: R`I = \frac{P}{V}`, source: 'Basic circuit theory' }],
      };
    },
  },
];

const ID_RE = /^gen-([a-z0-9-]+)-([a-z0-9]{1,8})$/;
export const isGeneratedId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);

/** A fresh question id for a generator. */
export function newGeneratedId(key: string, random: () => number = Math.random) {
  return `gen-${key}-${Math.floor(random() * 36 ** 6).toString(36)}`;
}

/** Rebuild a generated question (and its formulas) from its id; null if the id isn't one. */
export function generatedQuestion(id: string): { question: Question; formulas: Formula[] } | null {
  const m = ID_RE.exec(id);
  if (!m) return null;
  const gen = GENERATORS.find((g) => g.key === m[1]);
  if (!gen) return null;
  const made = gen.make(rng(parseInt(m[2], 36)));
  return {
    question: {
      id, track: gen.track, topic: gen.topic, difficulty: gen.difficulty, title: gen.title,
      prompt: made.prompt, parts: made.parts, hints: made.hints, solution: made.solution, sources: made.sources,
      formulas: made.formulas.map((x) => x.id),
    },
    formulas: made.formulas,
  };
}

/** What the practice page shows for each generator. */
export const generatorList = () => GENERATORS.map(({ key, track, topic, difficulty, title }) => ({ key, track, topic, difficulty, title }));
