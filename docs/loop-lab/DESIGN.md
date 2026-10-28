# Loop Lab — design

A control strategy lab on the site: put a controller on a realistic process, test it
the same way every time, find out where it is good enough and where it falls short,
then work up to whatever the process really needs, and learn the theory and the
implementation along the way.

Status: phase 1 built (2026-10-28) on the `loop-lab` branch — see "Phase 1 as built" at the end.

---

## 1. What it is for

Three uses, all in one tool:

| Use | What it means in practice |
| --- | --- |
| **Learn** | Each controller and each process comes with the theory behind it: derivations, assumptions, when it works, when it breaks. Guided case studies walk through "tune PI → see it fail → find out why → build the fix → compare". |
| **Practise** | A free bench: any controller on any process, standard tests, a scorecard, and a notebook that keeps every experiment so you build your own "which controller for which process" answers. |
| **Apply** | Bring a real loop: import a trend from the plant, identify a model, try strategies on it before commissioning, and export code and parameters for the PLC. |

### Principles

1. **Honest verdicts.** PID is the right answer for most loops in a plant. The lab
   must show that just as clearly as it shows where PID falls short. Every case study
   ends in a verdict, and some verdicts are "PI is enough — anything fancier costs more
   than it gives".
2. **Three perspectives on everything** — mechanical, control, automation (section 2).
   The same process or controller can be viewed through each of them.
3. **Real processes, not transfer functions.** Plants are nonlinear physics simulations
   with real instruments (valves, transmitters, noise, dead time). Linear models are
   derived from them at an operating point, the way you would do it on paper.
4. **Fair comparison.** Every controller on a process runs the same test scripts and is
   scored the same way, including on how hard it is to commission and maintain.
5. **Composable.** Plants, instruments, controllers and tests are separate pieces with
   fixed interfaces, so adding a process or a controller is mostly content, not new
   machinery.

---

## 2. Three perspectives

Every process and every controller page has three views, shown as tabs. The point is
to see the same loop the way a mechanical engineer, a control engineer and an
automation engineer each would.

### Mechanical / process view — "what is physically there"

- An animated **process schematic** (tank, valve, pump, pipe, heat exchanger, motor and
  load) that moves with the simulation: level rising, valve stem stroking, flow arrows.
- The **first-principles model**: mass, energy and momentum balances written out, with
  every parameter and its unit and where its value comes from.
- **Equipment behaviour that shapes control**: valve inherent vs installed
  characteristic and Cv sizing, pump and system curves, heat transfer (UA, LMTD),
  load-to-motor inertia ratio and resonance, transport delay = pipe length / velocity,
  sensor placement.
- "What would you change in the hardware?" notes: sometimes the best fix is a smaller
  valve, a sensor moved closer, or a stiffer coupling, not a better controller.

### Control view — "the loop as mathematics"

- A **Simulink-style block diagram** generated from the actual loop structure: plant,
  actuator, sensor, controller, feedforward and cascade paths, disturbance and noise
  inputs. Every wire can be probed to plot its signal.
- **Models**: the nonlinear equations, the linearization at the chosen operating point,
  the transfer function and the state-space form, side by side.
- **Analysis**: step and disturbance responses, Bode with margins, Nyquist, Nichols,
  root locus, pole-zero map, sensitivity functions (S, T, the "gang of four"), Ms.
- **Linearization across the range**: the plant linearized at several operating points
  on one plot. This is usually how you see *why* a single tuning cannot work everywhere.

### Automation view — "how it runs in a PLC"

- **P&ID with ISA-5.1 tags** (LT-101, LIC-101, FV-101) matching the schematic.
- **Siemens implementation**: which block (PID_Compact, PID_Temp, PID_3Step, or custom
  SCL), which cyclic interrupt OB and why the cycle time matters, the instance DB
  parameters, input scaling (NORM_X / SCALE_X), direct vs reverse acting, limits,
  manual mode and bumpless transfer, alarms.
- **Broad implementation**: the same controller as IEC 61131-3 Structured Text
  (CODESYS, TwinCAT), notes on Rockwell PIDE, and a plain reference implementation
  (TypeScript/Python/C) to show the algorithm with nothing hidden.
- **Commissioning checklist**: check transmitter scaling and direction, stroke the
  valve, open-loop bump test, tune, close the loop, set alarm limits, write it up.
- An **HMI faceplate** for the loop (SP/PV/CV, mode, trend, alarms), which is also the
  main way to drive the simulation by hand.

---

## 3. Building blocks

All simulation and analysis runs in the browser. The Pi only serves the page and
stores saved work.

```ts
/** A physical process: nonlinear state equations plus what can be measured and changed. */
interface Plant {
  id: string;
  states: SignalSpec[];          // e.g. level h [m]
  inputs: SignalSpec[];          // manipulated inputs, e.g. valve flow
  disturbances: SignalSpec[];    // e.g. outflow demand, feed temperature
  outputs: SignalSpec[];         // what transmitters can see
  params: ParamSpec[];           // physical constants, with units and sources
  derivatives(x: number[], u: number[], d: number[], t: number): number[];
  output(x: number[], u: number[], d: number[]): number[];
  /** Steady state for a chosen operating point (used for initial state and linearization). */
  steadyState(op: Record<string, number>): { x: number[]; u: number[] };
}

/** Valves, drives, transmitters: the parts between controller and process. */
interface Actuator { /* characteristic, stroke time, limits, deadband / stiction */ }
interface Sensor   { /* range, lag, noise, quantization, transport delay */ }

/** A control strategy. One interface for everything from on-off to MPC. */
interface ControllerDef<P> {
  id: string;
  rung: number;                  // position on the controller ladder (section 5)
  params: ParamSpec[];
  /** What it needs to be wired to: measured disturbances, a second measurement (cascade), a model... */
  needs: ControllerNeeds;
  create(p: P, ctx: LoopContext): ControllerInstance;
  /** Linear model of the controller, when one exists, for the analysis tools. */
  linear?(p: P): LTI;
  /** The block diagram for the control view. */
  diagram(p: P): Diagram;
  /** Code and parameter exports for the automation view. */
  exports: ExportSet<P>;
}

interface ControllerInstance {
  /** Runs once per controller sample time (as a PLC cyclic interrupt would). */
  step(io: { sp: number; pv: number; ff: number[]; dt: number }): number;
  setMode(mode: 'manual' | 'auto', manualOutput?: number): void; // bumpless
}

/** A test: a timeline of setpoint changes, disturbances, plant drift and faults. */
interface Scenario {
  id: string;
  duration: number;
  events: ScenarioEvent[];       // { t, kind: 'sp' | 'disturbance' | 'param' | 'fault', ... }
}

/** One run of one controller on one plant through one scenario. */
interface Run {
  traces: Record<string, Float64Array>; // every wire in the diagram
  metrics: Scorecard;
}
```

### Numerics

- **Simulation**: fixed-step RK4 for the plant at a small step; the controller runs at
  its own sample time with zero-order hold, like a PLC cycle. Transport delay is an
  exact buffer.
- **Linearization**: numerical Jacobian of `derivatives` / `output` at an operating
  point → state space → transfer function.
- **Linear tools**: polynomial and matrix arithmetic, eigenvalues / polynomial roots,
  complex frequency response, c2d (ZOH, Tustin), Padé for dead time where an
  analysis needs a rational model (root locus) — exact delay everywhere else.
- **Heavy work** (Monte Carlo, optimization, MPC) runs in a Web Worker so the page stays
  responsive.
- **Tests** in `lib/loop-lab/*.test.ts` check the numerics against cases with known
  answers (the analytic step responses already in `lib/daily/widgets.ts`, textbook
  margins, steady states solved by hand).

---

## 4. Process catalogue

Each process is picked to teach one thing. About a third of them are processes where
PID **is** the answer — the lab should be as convincing about those as about the hard
ones.

### Where PID is the right answer

| Process | Physics in short | What it teaches | Expected verdict |
| --- | --- | --- | --- |
| **Liquid flow loop** | Valve + pipe, fast, noisy transmitter | PI with low gain and fast integral; derivative only amplifies noise; filtering vs lag | PI, no D. Anything fancier is wasted. |
| **Stirred-tank temperature** (small dead time) | Energy balance, jacketed heating | Textbook PID; derivative helps on a lag-dominant process | PID is near-optimal. |
| **Motor speed** | Inertia + friction, current-limited drive | PI on a first-order mechanical system; saturation and anti-windup | PI with anti-windup. |
| **Gas receiver pressure** | Ideal-gas balance, integrating-ish | Fast self-regulating loop, valve sizing matters more than tuning | PI; fix the valve if it struggles. |
| **Surge tank level** | Integrating process | The goal is to *absorb* flow changes, not hold level tight; averaging level control | Loosely tuned P or PI. Tight tuning is wrong. |
| **Room / oven with a relay heater** | Thermal lag, on-off actuator | When on-off with hysteresis is fine, and what PWM / time-proportioning adds | On-off is often enough. |

### Where PID falls short — the escalation cases

| Process | Why PID struggles | What it leads to |
| --- | --- | --- |
| **Conical tank level** | Cross-section changes with level, so the process gain changes several times over the range | Gain scheduling |
| **Equal-% valve on a flow / temperature loop** | Installed characteristic makes gain depend on valve position | Characterization, gain scheduling |
| **Steam-heated heat exchanger** | Steam pressure upsets reach the outlet before the loop sees them | Cascade (steam flow inner loop), feedforward |
| **Process with a measured inlet disturbance** | The disturbance is known before it hits | Feedforward (static, then dynamic) |
| **Conveyor / weigh belt, long pipe runs** | Dead time much longer than the time constant | Smith predictor, IMC — and how fragile they are to dead-time error |
| **Boiler drum level** | Inverse response (shrink and swell) | Three-element control (feedforward + cascade) |
| **Exothermic batch reactor** | Gain and dynamics change through the batch; can run away | Gain scheduling, split-range heat/cool, adaptive control |
| **Two interacting tanks / blending** | Several inputs and outputs coupled together | Relative gain array, decoupling, MPC |
| **Compressor near its limits** | Hard constraints that must not be crossed | Override and selector control, MPC |
| **Valve with stiction** | Looks like a tuning problem, isn't | Diagnosing oscillation causes; not every problem is the controller |
| **Magnetic levitation / cart-pendulum** | Open-loop unstable | State feedback, observers, LQR |
| **Servo axis with a flexible coupling** | Mechanical resonance | Notch filters, feedforward, cascaded position/velocity/current loops |

### What each process defines

- Physics: equations, parameters (with units and realistic values), operating range.
- Instruments: valve or drive, transmitters, their imperfections.
- A **nominal operating point** and the range to test over.
- **Test scripts** (section 6) tuned to what matters for that process.
- The three views (section 2): schematic, block diagram, P&ID / PLC notes.
- A **case study** (section 7) with its verdict.

---

## 5. The controller ladder

Every controller fits the same interface (section 3), so any controller can go on any
process it has the wiring for.

1. **On-off with hysteresis**, time-proportioning (PWM)
2. **P, PI, PID** — ideal / parallel / series forms; 2-DOF setpoint weighting (b, c);
   derivative filter; derivative on PV; anti-windup (clamping, back-calculation);
   bumpless manual/auto; output rate limits
3. **Gain scheduling** — scheduled on PV, SP, CV or an external variable;
   interpolated or switched; bumpless between regions
4. **Characterization** — inverting a known nonlinearity (valve, conical tank) before the PID
5. **Feedforward** — static, then dynamic (lead-lag), combined with feedback
6. **Cascade** — inner and outer loops, tuning order, the inner-loop speed rule
7. **Ratio, override / selector, split-range** — the classic plant-floor structures
8. **Smith predictor and IMC** — dead-time compensation and model-based tuning
9. **Decoupling** — RGA, static and dynamic decouplers
10. **State feedback and observers** — pole placement, Luenberger observer, Kalman filter
11. **LQR / LQG**
12. **MPC** — linear MPC with constraints, horizons, move suppression
13. **Adaptive** — self-tuning regulators, MRAC
14. **ADRC** — active disturbance rejection, a modern PID alternative
15. **Custom** — write your own controller in Structured Text (a small interpreter) or
    TypeScript and run it on the bench

### What each controller card has

- **Theory**: derivation, the assumptions it relies on, the block diagram.
- **When it works and when it breaks**, with links to the processes that show each.
- **How to tune it**: step by step, with the rules that apply (Ziegler–Nichols,
  Cohen–Coon, Lambda/IMC, SIMC, AMIGO, loop shaping, pole placement, Q/R weights...),
  each showing its formula and assumptions.
- **How to implement it**: discrete form, sample-time choice, windup, initialization,
  manual/auto, what happens on a sensor fault.
- **Siemens**: the block to use and its parameters, or the SCL to write if there is no
  standard block.
- **Code**: the algorithm in SCL, Structured Text and a plain reference language.

---

## 6. Test bench and scorecard

### Standard test scripts

Each process has a set of named scripts so every controller is tested the same way:

- **Setpoint steps across the range** — low, middle and high operating points.
- **Disturbance sequence** — the process's real upsets (load changes, supply pressure, feed
  temperature).
- **Noise and instruments** — realistic transmitter noise, valve deadband.
- **Model mismatch** — the plant drifts from the model the controller was tuned on
  (gain ±30 %, dead time ±50 %). Model-based controllers are judged here.
- **Faults** — a sensor freeze, a saturated valve, a mode switch mid-run.

### Scorecard

| Group | Measures |
| --- | --- |
| Performance | IAE / ITAE, overshoot, settling time, steady-state error, disturbance peak and recovery |
| Effort | Valve travel (wear), output saturation time, output noise |
| Robustness | Gain and phase margins, Ms, worst case across a Monte Carlo spread of plant parameters |
| **Cost of complexity** | Tuning parameters, needs a model or not, extra instruments, commissioning effort, how easy it is for site technicians to maintain |

The **cost of complexity** row is what makes "PID is good enough" a real verdict rather
than an opinion: a controller that is 8 % better on IAE but needs a process model, two
extra transmitters and an engineer to retune it often loses.

### Comparing

- Overlay the trends of several runs.
- Scorecards side by side, best-in-row highlighted.
- Probes on any wire of the block diagram during a run.

---

## 7. Learning mode: case studies

Each case study follows the same arc:

1. **The situation** — the process, what the plant needs from it, the three views.
2. **Baseline** — tune a PI loop with a standard rule, run the test scripts.
3. **Observe** — what goes wrong (or doesn't), on the trend and the scorecard.
4. **Diagnose** — the analysis that explains it: linearization across the range,
   margins, a disturbance path on the block diagram.
5. **Theory** — the controller card for the next step up.
6. **Build and tune** it.
7. **Compare** on the same scripts.
8. **Verdict** — what to use on this process, and the cost of complexity.
9. **On site** — how you would implement it in a PLC, and the commissioning steps.

Case studies are optional; the free bench is always available. Daily controls
questions can link to a case study or open the bench set up for that question.

---

## 8. Real-application mode

- **Import a trend** — CSV, including traces exported from TIA Portal; pick the time,
  PV, SP and CV columns.
- **Identify a model** — FOPDT, SOPDT, integrating, with fit % and residuals. Identify at
  several operating points to see whether the gain changes, and build a gain schedule
  from the result.
- **Test strategies** on the identified model with the same scripts and scorecard.
- **Export** — SCL / Structured Text for the chosen controller, PID_Compact or PID_Temp
  parameters, and a printable tuning report (model, specs, margins, plots).
- **Later: software in the loop** — the exported SCL running in PLCSIM Advanced against
  the Loop Lab plant. PLCSIM runs on a PC, not the Pi, so this needs a small local bridge
  and is the last phase.

---

## 9. Site integration

- **Route**: `/loop-lab` (bench), `/loop-lab/processes/[id]`, `/loop-lab/controllers/[id]`,
  `/loop-lab/cases/[id]`. Read the Next.js guides in `node_modules/next/dist/docs/` before
  adding routes (see `AGENTS.md`).
- **Nav**: its own top-level "Engineering" group, or under Tools — to decide.
- **Code layout**: `lib/loop-lab/` for plants, controllers, numerics and exports (pure
  TypeScript, tested); `components/loop-lab/` for views.
- **Charts**: interactive SVG charts in the style of `components/daily/Widgets.tsx`
  (log axes, dragging, probes), not recharts, which does not handle Bode plots or
  dragging well.
- **Block diagrams**: drawn from each controller's `diagram()`, laid out from templates.
  A free-form diagram editor is not planned.
- **Saving**: experiments and notebooks saved to the signed-in account in
  `.data/loop-lab/` with the existing JSON store (and therefore backed up); a setup can
  also be shared as a link.
- **Phones**: everything readable; dragging on plots and the code editor are desktop-first.

---

## 10. Phases

### Phase 1 — the first two case studies, end to end

Proves every building block on one "PID is enough" process and one escalation:

- **Processes**: liquid flow loop (verdict: PI) and conical tank level (verdict: gain
  scheduling).
- **Controllers**: on-off, P/PI/PID with all the practical features, gain scheduling,
  characterization.
- **All three views** for both processes and all these controllers.
- **Bench**: test scripts, scorecard (including cost of complexity), run overlays.
- **Analysis**: step and disturbance responses, Bode with margins, pole-zero map,
  linearization across the range.
- **Exports**: SCL, Structured Text, PID_Compact parameters.
- **Notebook**: save and compare runs.

### Phase 2 — feedforward and cascade

Stirred-tank temperature, heat exchanger, measured-disturbance process; feedforward,
cascade; block-diagram probes; trend import and model identification.

### Phase 3 — plant-floor structures and dead time

Surge tank, conveyor dead time, drum level, compressor limits, stiction; Smith
predictor, IMC, ratio, override / selector, split-range; guided case studies for each.

### Phase 4 — modern control

Interacting tanks, batch reactor, maglev / pendulum, servo resonance; state feedback,
observers and Kalman filter, LQR/LQG, MPC, decoupling, adaptive, ADRC; custom
controllers in Structured Text.

### Phase 5 — software in the loop

PLCSIM Advanced bridge to run exported SCL against Loop Lab plants.

---

## 11. Open questions

- Nav placement: phase 1 puts Loop Lab first under **Tools**; a separate "Engineering" group is still an option.
- Public or signed-in only? Phase 1: public to use, the notebook saves to the account when signed in and to the browser when not.
- Which real loops from work would make good case studies (anonymized)?

---

## 12. Phase 1 as built

- **Routes**: `/loop-lab` (bench: Tests · Live · Mechanical · Control · Automation · Notebook),
  `/loop-lab/cases/[id]` (`flow-pi`, `tank-schedule`), `/loop-lab/processes/[id]`, `/loop-lab/controllers/[kind]`,
  `/api/loop-lab/notebook` (per-user JSON in `.data/loop-lab/`).
- **Library** (`lib/loop-lab/`): `linalg` (eigenvalues, expm, c2d), `model` (process/instrument types, valve
  characteristics), `processes/` (flow, tank), `controllers` (on-off, PID, gain scheduling, characterization,
  complexity), `sim` (RK4 plant, PLC-style controller cycle, seeded noise), `linear` (Jacobian linearization,
  half-rule FOPDT, Bode, margins, closed-loop state space with Padé delay, step responses, robustness spread),
  `tuning` (SIMC, Lambda, ZN, Cohen–Coon, AMIGO), `score` (scorecard), `export` (SCL, ST, reference code,
  PID_Compact mapping), `setup` (shareable links, notebook), `content` (the three views' text, controller cards,
  case studies). Tests in `loop-lab.test.ts` check the numerics against hand derivations.
- **Verdicts the numbers support**: flow loop → PI (PID roughly doubles valve travel for a few % of IAE; on-off
  cycles the valve hundreds of times an hour); conical tank → characterize (control volume) or gain-schedule; one
  PI tuned at the bottom overshoots ~18 % near the top, tuned at the top it passes ~6× more noise to the valve.
- **Not in phase 1**: Monte Carlo is on the linear margins only (not time runs); no trend import yet (phase 2).
