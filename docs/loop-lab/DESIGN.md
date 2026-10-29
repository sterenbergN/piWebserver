# Loop Lab — design

A control strategy lab on the site: put a controller on a realistic process, test it
the same way every time, find out where it is good enough and where it falls short,
then work up to whatever the process really needs, and learn the theory and the
implementation along the way.

Status: phases 1 to 4 (3a, 3b, 4a, 4b, 4c) built (2026-10-29) on the `loop-lab` branch — see "as built" at the end.

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
- **Not planned: software in the loop** — running the exported SCL in PLCSIM was dropped
  (2026-10-29): Loop Lab doesn't connect to PLCSIM or TIA Portal. The exports are for
  the engineer to take into their own project.

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

Split in two, both built: **3a** is surge tank, belt feeder with the Smith predictor, and boiler drum
level. **3b** is override / selector (a steam flow limit on the heat exchanger, a high-level override on the
surge tank), split-range (a heated-and-cooled reactor) and ratio (in-line blending). IMC, compressor limits and
stiction are left for later.

### Phase 4 — modern control

Interacting tanks, batch reactor, maglev / pendulum, servo resonance; state feedback,
observers and Kalman filter, LQR/LQG, MPC, decoupling, adaptive, ADRC; custom
controllers in Structured Text.

Split in three: **4a** (built) is state feedback, observers, Kalman filter and LQR on a crane with a swinging
load, a drive with a flexible shaft and magnetic levitation. **4b** (built) is multivariable: a mixing tank,
the relative gain array, decoupling and MPC. **4c** (built) is the model-light alternatives (adaptive control, ADRC), the
batch reactor and custom controllers in Structured Text.

### Phase 5 — software in the loop (dropped)

A PLCSIM Advanced bridge was built and then removed at the user's request (2026-10-29): Loop
Lab stays self-contained and doesn't connect to PLCSIM or TIA Portal.

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

## 13. Phase 2 as built

- **Processes**: stirred-tank temperature (jacketed vessel; where PID *with derivative* is the answer), steam heat
  exchanger (steam pressure unmeasured; steam flow, process flow and inlet temperature measured), and "your plant",
  an identified FOPDT / SOPDT / integrating model whose test scripts scale with its own time constants.
- **Controllers**: feedforward (gain + lead-lag per measured disturbance, deviation form, bumpless) and cascade
  (master sets the slave's setpoint; master holds its integral while the slave is saturated; feedforward goes into
  the slave setpoint). Availability depends on the process (cascade needs a secondary measurement, feedforward a
  measured disturbance).
- **Analysis**: linearization w.r.t. disturbances and the secondary measurement; one closed-loop builder for single,
  feedforward and cascade loops; master and slave margins; feedforward responses with and without; models reduced
  to the valve → output path before the half rule; cascade outer model fitted to the inner-closed step response.
- **Tuning**: inner/outer loop selector for cascade; feedforward designed from fitted path models (−K_d/K_u,
  lead τ_u, lag τ_d, with a note when the disturbance outruns the valve).
- **Identify tab**: CSV import (TIA trace exports with semicolons and decimal commas, historians, timestamps),
  column guessing, fit window, least-squares fit of three model types with fit % and residuals, kept fits at several
  operating points with a gain-spread verdict, and "use as a process" with a SIMC PI to start from.
- **Exports**: LL_PID gains Feedforward / HoldIntegral inputs and an AtLimit output; LL_LeadLag; cascade call site
  with master and slave; PID_Compact settings for both loops, with notes on PID_Temp's built-in cascade.
- **Case studies**: `stirred-pid` (D buys margin; filter it) and `hx-cascade-ff` (match the tool to the upset's path).
- **Not in phase 2**: identified models are linear (no schedule built from several fits yet); feedforward dead time
  compensation (only lead-lag).

## 14. Phase 3a as built

- **Processes**: surge tank (pure integrator, negative gain, averaging level; `averaging` spec of the
  allowed swing for a design upset), belt feeder (screw lag + 30 s belt as transport delay, density upsets),
  boiler drum (water inventory + swell − shrink; feedwater flow as the secondary, steam flow measured, pump
  pressure unmeasured).
- **Smith predictor** (rung 7): first-order model + dead-time ring buffer in the controller (n = ⌊θ/Ts⌋, ZOH-exact
  model update), the PID fed y + ŷ − ŷ(t − θ), re-zeroed in manual; the prediction is traced (`pred`) and plotted.
  Linear form C/(1 + C·Gm(1 − e^{−θs})) in the Bode/margins (fine linear grid for the ripples, phase margin
  as the angle to −1 at every crossover, delay margin as the smallest over all crossovers), and model lag +
  Padé copy of its delay in the closed-loop builder. Exports: `LL_Smith` FB (SCL / ST, buffer of 1000), call
  order (predictor with last cycle's output, then the PID), PID_Compact note, reference code. Editor with
  "Fill from the plant". Auto-tune: model from the plant, PI on what is left, τc = max(τ, θ/2) (Ms ≈ 2 with the
  dead time ±15 % off; τc = τ alone gives Ms ≈ 2.4 and rings on a slowed belt).
- **Analysis fixes**: integrating gains keep their sign (k′ from Im G); the effective dead time of an integrator
  comes from the ramp asymptote (Σ pole τ − Σ zero τ), so a right-half-plane zero (drum shrink, ~35 s) counts
  (θ 11 → 46 s; the old estimate gave a PI with Ms ≈ 6); phase crossovers at −180° ± 360°k.
- **Tuning**: "Lambda for integrating (averaging level)" rule, Kc = (2λ+θ)/(k′(λ+θ)²), Ti = 2λ+θ; auto-tune on an
  averaging process picks λ = e·swing/(k′·upset). Feedforward on an integrating path: gain = ratio of ramp rates
  (the mass balance), no lead-lag.
- **Verdicts the numbers support**: surge → slow PI or P-only (outflow 8× gentler than a tight PI, IAE several
  times "worse", which is the point); feeder → Smith roughly halves IAE vs PI at τc = θ (setpoint settling 57 s
  vs 90 s), little help on density upsets; drum → three-element (load-step swings 100–160 mm → 20–35 mm, pump
  pressure dips 67 mm → 3 mm, IAE 430 → 107).
- **Case studies**: `surge-averaging`, `feeder-smith`, `drum-three-element`.
- **Not in 3a**: Smith for integrating plants (modified structures), dead time tied to a measured belt speed
  (described, not simulated), level limit protection (comes with override control in 3b).

## 15. Phase 3b as built

- **Override** (rung 8): normal PID and a limit PID on the same measurement or the secondary one, high or low
  select, optional tracking by external reset feedback (the idle controller's integral follows the selected
  output through its own Ti, so its output is valve + its own P and D). Linear analysis is the normal loop.
  Exports: LL_PID gained ExtResetEnable / ExtReset; call site with MAX/MIN and an OvrSelected flag;
  PID_Compact note (manual-tracking workaround). Presets: HX steam-flow limit 1000 kg/h (low select), surge
  tank high-level override at 2.4 m (high select). New tests: HX `steam-limit`, surge `big-surge`.
- **Ratio** (rung 9): SP₂ = R × wild flow, R fixed or set by a trim over [rLo, rHi]; trim holds while the
  flow loop is saturated; bumpless via the running ratio. Linearized as a cascade with outer slope F_A₀·ΔR/span₂
  and feedforward R₀·100/span₂ (`ratioAt`), so Bode, margins, robustness and tuning reuse the cascade
  machinery. Needs `ProcessDef.ratio`.
- **Split-range**: a process structure, not a controller: `ProcessDef.split`, split point and gap as valve
  parameters, two valves from one signal (`splitValves`), a balanced cv characterization (rung 4) that also
  jumps the gap, split-range output lines in the exports.
- **Processes**: reactor temperature heated and cooled (cooling side ≈ 3.5× the steam side's gain per %),
  in-line blending (wild diluent measured, concentrate flow loop, analyzer with 20 s sample delay; gain and
  mixing time vary 3 : 1 with rate). Scenarios can start from their own disturbances (`initialDist`).
- **Verdicts the numbers support**: steam limit → override with tracking (steam held at ≈ 1000 kg/h; without
  tracking 1060 kg/h on takeover and a 77 °C instead of 71 °C overshoot on hand-back); reactor → balance the
  split (a PI tuned on steam is linearly unstable on cooling and hunts at 3× the valve travel; detuned for
  cooling it overshoots 23 % on steam; balanced, 5–8 % both sides; a 6 % gap quadruples the wander near the
  split); blending → ratio with an analyzer trim (production upsets 27 % → < 1 % of span; total IAE 321 → 118;
  vs additive feedforward, 10–13 % instead of 28–32 % overshoot at low rate, a third of the mismatch IAE).
- **Case studies**: `hx-steam-limit`, `jacket-split`, `blend-ratio`; `surge-averaging` gained a high-level
  override step.
- **Not in 3b**: override on more than two controllers, cross-limiting for combustion, energy cost of a
  split-range overlap (no energy measure in the scorecard yet).

## 16. Phase 4a as built

- **State feedback with an observer** (rung 10, one controller kind for the whole family): u = u₀ − K·x̂ + N_r·r,
  plus the offset remover. The controller's model is the plant linearized at its design point (`statespace.ts`),
  less the secondary transmitter's filter when that reading isn't used.
  - **Regulator** on the physical states (transmitter filters get no gain and keep their poles): pole placement
    with a dominant pair (ω_n, ζ), where lightly damped pairs keep their frequency and get ζ, unstable poles are
    mirrored and faster ones stay; or LQR with weights q_y, q₂, q_i against 1 on the output. Pole placement is the
    Sylvester-equation method (balanced, time-scaled, Jordan blocks for repeats, checked afterwards), Ackermann as
    a fallback; LQR is the Riccati equation by the matrix sign function.
  - **Observer:** a Kalman filter (process noise scaled to the regulator's speed so one "upsets" knob means the
    same on any plant) or pole placement at a multiple of the regulator's poles, on one or both measurements.
  - **No offset by:** estimating a constant disturbance where it acts (the first unmeasured one, in % of its
    range; a load at the valve if all are measured) and cancelling it through N_d; or an integral of the error with
    anti-windup; or nothing.
  - **Runs** as the discretized design (ZOH, the applied output fed back to the observer), bumpless from manual.
    **Analysis** as a continuous linear controller (`LinearController` kind `ss`): Bode and margins broken at the
    valve (phase margin as the angle to −1), closed loop in the state-space builder.
  - **Exports:** `LL_StateFb` (SCL/ST) with LReal matrices, call site, reference TypeScript; the PID_Compact table
    becomes the gain table.
- **Processes:** crane with a swinging load (speed-controlled trolley, pendulum, wind; PV the load position,
  sway angle as a measurement-only secondary, no cascade), drive with a flexible shaft (two masses and a spring,
  12 Hz resonance, roll and motor encoders, 2 ms), magnetic levitation (unstable, 1 ms, end stops). Instruments
  can be millisecond-fast (`fast` instrument ranges); the live view has slow motion.
- **Auto-tune:** declines on an open-loop unstable plant (no rule applies, says why); on a resonant plant, slows
  the rule down until the loop is stable with Ms ≤ 1.6 over the parameter spread, and says so; for state feedback,
  the fastest ω_n (or q_y) that keeps Ms ≤ 1.6 at the design point.
- **Verdicts the numbers support:** crane → state feedback with a sway sensor and a wind-aware observer (a 20 m
  move in 23 s with 0.09° of swing left, against a PI that takes over a minute and leaves 2°; without the wind
  model a gust drags the load 8 m; load position alone can't observe the wind). Flexible shaft → cascade on the
  motor speed for most machines (settles in ~1 s, Ms 2.7); state feedback (active damping) three times faster with
  Ms 1.5. Levitation → PID wins (PD + slow I with setpoint weight 0.3: 0.2 s, no overshoot; with b = 1, 130 %
  overshoot); state feedback no clear gain.
- **Case studies:** `crane-antisway`, `servo-resonance`, `maglev-unstable`.
- **Also:** integrators shown as k′/s in the transfer function; multi-letter subscripts braced in parameter symbols;
  phase margin wrapped into (−360°, 0°].
- **Not in 4a:** LQG loop-transfer recovery, a design scheduled on the rope length or the gap, notch filters as a
  PID option, observers for processes with transport delay (the delay isn't in the controller's model).

## 17. Phase 4b as built

- **2×2 processes** (`ProcessDef.mimo`): a second valve and a second controlled variable (the secondary measurement).
  The second valve's command is a disturbance marked `manipulated` that the process models its own actuator for,
  so linearization (`Bd` gives the second input column), analysis with the second loop open, and every SISO
  controller keep working unchanged. Tests get `sp2` events and `initialSp2`; the loop runs a second setpoint and
  manual value; controllers may return `out2()`; traces add `pv2True`, `cv2`, `valve2`. A controller without a second
  output leaves the second valve where it is.
- **Scoring both variables:** IAE, steps and upsets on each, each setpoint change counted as an upset on the other
  variable ("effect on …"), travel of both valves, saturation of the worse.
- **Process:** mixing tank, hot and cold water into a gravity-drained tank, temperature and level. λ₁₁ =
  (T_h − T)/(T_h − T_c): 0.82 at 25 °C, 0.64 at 35 °C, 0.36 at 50 °C, 0.27 at 55 °C, so the right pairing flips
  with the recipe. Tests: temperature and level changes, demand, hot supply cooling, a hot recipe (55 °C) and peak
  demand beyond the hot valve's capacity.
- **Multi-loop PID and decoupling** (rung 11): a PID per variable, direct or crossed pairing, an optional static
  decoupler from the steady-state gains (`multivar.ts`: gains, RGA, decoupler), integral hold on a pinned valve,
  bumpless by undoing the decoupler. Linear form as an `ss` controller with direct feedthrough and a second output;
  the loop is broken at the main valve with the second loop closed (L = −(T₁₁ + T₁₂T₂₁/(1 − T₂₂))). Auto-tune: SIMC
  per pair with the other open, and the relative gain in the note.
- **MPC** (rung 12): linear model at the design point, discretized; Kalman filter with a constant load at each valve
  (offset-free; better on load changes than offsets on the outputs); prediction over P cycles, M moves of both
  valves, weights per output and on moves; valve limits as constraints; a box QP solved by projected Gauss–Seidel
  with a warm start. No linear analysis (constrained), said so in the Control view. Export: `LL_Mpc` in SCL/ST (the
  same solver, LReal matrices), reference TypeScript; notes on PCS 7 ModPreCon and MPC on an edge device.
- **Verdicts the numbers support:** one loop leaves the level wandering 64–72 cm; two loops tuned alone fight (a level
  change pulls the temperature 6 °C, a demand change 3.8 °C); a static decoupler takes that to 0.1 and 0.03 °C; MPC
  matches it on interaction, is better on the hot-supply upset (0.7 against 1.6 °C) and at the limit (its weights
  choose what gives: temperature first holds 48.4 °C and lets the level fall to 0.92 m; it recovers without the
  55 °C overshoot two plain loops show). For one tank: decouple (or control total flow and hot fraction).
- **Case study:** `mixing-mimo`.
- **Not in 4b:** dynamic decouplers, output constraints and soft constraints in the MPC, larger than 2×2, the
  quadruple tank (multivariable right-half-plane zeros), gain-scheduled decoupling per recipe.

## 18. Phase 4c as built

- **Batch reactor** (exothermic A → B on a TCU): reactant, batch and jacket temperatures; Arrhenius heat release, so
  positive feedback. Processes can freeze slow states in the linear model (`ProcessDef.frozen`): the reactant, so
  the model describes one stage of the batch. Setpoint events can ramp (`ramp`, units/s). At 80 °C the gain is 3.9
  with a full charge and 0.86 near the end, the time constant 12 and 4 min; the cooling margin (UA + UA_l −
  dQ_r/dT) is 12 kW/K at the start and goes negative across the ±20 % spread. Mechanical view: a Semenov diagram,
  and gain and time constant against the reactant left.
- **Self-tuning PI** (rung 13): RLS on y(k) = a·y(k−1) + b·u(k−1−d) + c with forgetting, SIMC from the estimate every
  cycle; learns only on movement above the noise, bounds the covariance, keeps gains within 5× of the start and
  only accepts the expected sign. Linear analysis: the PI it would converge to at each point. Export: LL_PID plus an
  `LL_SelfTune` FB writing Gain and Ti each cycle.
- **ADRC** (rung 14): linear ADRC of order 1 or 2, an extended state observer with all poles at −ω_o, the law
  cancelling the total disturbance; discretized exactly, the observer fed the applied output. Linear form as an
  `ss` controller. Auto-tune reads b₀ off the frequency response at 4× the bandwidth (works on unstable and
  integrating plants) and picks the fastest ω_c with Ms ≤ 1.6, ω_o = 3·ω_c. Export: `LL_Adrc`.
- **Your own controller** (rung 15): an IEC 61131-3 Structured Text interpreter (`st.ts`: VAR declarations,
  IF/FOR/WHILE/REPEAT/EXIT/RETURN, operators, the standard functions with named arguments, 100 000 steps per cycle
  before it calls it an endless loop, errors with line numbers). The code reads SP, PV, the % values, TS, TIME,
  MANUAL, MAN_OUT (and the second loop's on a 2×2 process) and writes OUT (OUT2). It starts as the process's PI
  written out, which matches the built-in PI exactly. Code that doesn't compile or fails holds the valve. Editor
  with live checking and an explicit Run. Export: `LL_Custom` with your VARs as statics and the # prefixes added for SCL.
- **Auto-tune:** dispatches ADRC and adaptive before the "unstable plant" refusal.
- **Verdicts the numbers support:** batch → tune for the start of the batch and make the recipe safe. A PI tuned on a
  quiet batch has Ms 2.6 with a full charge and overshoots a strong batch by 2.4 °C; tuned for the start it is
  robust but lags a 2 °C/min ramp by 26 °C; the self-tuner reaches Ms 1.4 and no overshoot but detunes itself to Kc
  0.25 in a quiet late hold; ADRC holds the start with Ms 1.6 and no reaction model but lags ramps by 22 °C. None
  of them holds every reactor in the ±20 % spread: the cooling margin is the recipe's and the safety system's job.
  Your own controller: the PI without its edges starts every test with a bump (IAE ten times worse).
- **Case studies:** `batch-adaptive`, `write-your-own`.
- **Not in 4c:** MRAC, gain scheduling on batch time or conversion, nonlinear ADRC, arrays and CASE in the ST subset.
