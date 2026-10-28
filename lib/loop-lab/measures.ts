// What each scorecard measure means, exactly how score.ts and linear.ts
// compute it, what a good value looks like, and what moves it. Markdown with
// $math$; String.raw keeps LaTeX backslashes intact.

export type MeasureInfo = {
  /** What it tells you, in a sentence or two. */
  what: string;
  /** How Loop Lab calculates it. */
  how: string;
  /** What to aim for. */
  good: string;
  /** What changes it. */
  improve: string;
};

export const MEASURES: Record<string, MeasureInfo> = {
  iae: {
    what: 'Integral of absolute error: how much the process value was away from the setpoint, added up over time. One number for overall control performance, counting both setpoint changes and upsets.',
    how: String.raw`For every controller cycle of every test, take the gap between setpoint and the **true** process value (not the noisy reading) in % of the transmitter span, and add it up:

$$\text{IAE} = \frac{1}{60}\sum_{\text{tests}} \sum_k |r_k - y_k|\, T_s \quad [\%\cdot\text{min}]$$

It is summed over all the tests, so it is only comparable between setups on the same process.`,
    good: 'There is no absolute target: lower is better, and the comparison between setups is what counts. A small IAE bought with a lot of valve movement is not a win.',
    improve: 'Faster tuning (more gain, shorter integral time) lowers it until the loop starts to ring. For upsets, feedforward or cascade remove the error at its source instead of waiting for feedback.',
  },
  worstOvershoot: {
    what: 'How far the process value shoots past a new setpoint before coming back, as a share of the step. The worst over all setpoint steps.',
    how: String.raw`For each setpoint step from $r_0$ to $r_1$ (step $\Delta = r_1 - r_0$), over the time until the next event:

$$\text{overshoot} = \max_t \frac{\operatorname{sign}(\Delta)\,(y(t) - r_1)}{|\Delta|} \times 100\,\%$$

Zero if it never passes the new setpoint. The scorecard shows the largest over all steps in all tests.`,
    good: 'Under about 5 % for most process loops. Some loops must never overshoot (a reactor temperature near a limit); others don\'t care (a surge tank).',
    improve: 'Lower the gain, or lengthen the integral time. Setpoint weighting (b < 1) softens the response to setpoint steps without slowing disturbance rejection. Derivative adds damping on lag-dominant processes.',
  },
  worstSettling: {
    what: 'How long the process value takes to settle at a new setpoint and stay there. The slowest over all setpoint steps.',
    how: String.raw`From the moment of the step until the last time the true process value is outside a band around the new setpoint, where the band is 2 % of the step size (but at least 0.5 % of span):

$$\text{band} = \max(0.02\,|\Delta|,\ 0.005\,\text{span})$$

If it is still outside the band when the next event comes, it counts as **never settled**.`,
    good: 'Depends entirely on the process: seconds for a flow loop, tens of minutes for a big vessel. Compare it with the open-loop time constant — settling in 2–4 time constants is normal for a well-tuned loop.',
    improve: 'Faster tuning, until overshoot and ringing start to cost more time than they save. Oscillation (settling far longer than the rise time) means too much gain or too little phase margin.',
  },
  worstPeak: {
    what: 'How far a disturbance pushes the process value away from setpoint before the controller catches it. The worst over all upsets.',
    how: String.raw`For each disturbance event, the largest deviation of the true process value from setpoint until the next event, in % of the transmitter span:

$$\text{peak} = \max_t |r(t) - y(t)| \cdot \frac{100}{\text{span}}$$`,
    good: 'Set by the process: how far it is allowed to wander (product quality, alarm limits). Compare between setups — this is where feedforward and cascade show what they are worth.',
    improve: 'Feedback can only start correcting once the PV has moved, so more gain helps only so much. Feedforward acts on a measured disturbance before it arrives; cascade catches it in a faster inner variable. On processes with dead time, the peak is mostly decided by the dead time.',
  },
  worstRecovery: {
    what: 'How long the process value takes to get back to setpoint after a disturbance. The slowest over all upsets.',
    how: String.raw`From the disturbance until the last time the true process value is more than **1 % of span** from setpoint, within the time before the next event. If it is still out at the next event it counts as **never**, unless the valve is pinned at a limit at that moment: then no controller could have recovered, and that upset is left out.`,
    good: 'Compare between setups. A slow recovery with no overshoot usually means too long an integral time; a slow recovery with oscillation means too much gain.',
    improve: 'Shorter integral time (more integral action), within what the margins allow. SIMC\'s rule of keeping Ti ≤ 4(τc + θ) is aimed exactly at this on lag-dominant processes.',
  },
  travel: {
    what: 'How much the valve stem moves: a direct measure of wear on packing, positioner and actuator.',
    how: String.raw`The sum of every change in the **actual** stem position (after actuator lag, rate limit and deadband), in full strokes, per hour of test time, averaged over all tests weighted by their length:

$$\text{travel} = \frac{\sum_k |s_k - s_{k-1}| / 100}{\text{test time in hours}}$$`,
    good: 'Compare between setups: the same control quality with less travel is better. A loop whose valve strokes constantly in steady state is tuned too hard for its noise.',
    improve: 'Lower gain, a derivative filter (or no derivative), more transmitter damping — all trade a little performance for a lot less wear. Deadband in the valve shows up here as stick-slip.',
  },
  cvActivity: {
    what: 'How busy the controller output is: mostly measurement noise multiplied by the gain and passed to the valve.',
    how: String.raw`The sum of every change in the controller output per minute, in %, averaged over all tests weighted by their length:

$$\text{activity} = \frac{\sum_k |u_k - u_{k-1}|}{\text{test time in minutes}}$$

It counts every controller cycle, so a faster cycle counts more small moves than a slow one. Compare setups with the same cycle time.`,
    good: 'Compare between setups. If it is far higher than valve travel, the valve is filtering out most of what the controller sends — wasted effort and wear on the positioner.',
    improve: 'The proportional gain multiplies the noise directly; derivative multiplies it by up to 1/a more (a = derivative filter ratio). Lower gain, a larger filter ratio, or transmitter damping.',
  },
  saturated: {
    what: 'The share of time the controller output sat at 0 or 100 %: the valve could do no more.',
    how: String.raw`The fraction of controller cycles, over all tests weighted by length, where the output was at its lower or upper limit (within 0.01 %).`,
    good: 'Some is normal during big setpoint changes and upsets the valve can\'t cancel. A lot in steady state means the valve is undersized or the operating point is near its end.',
    improve: 'Mostly a hardware question (valve size, supply). What the controller can do is not make it worse: anti-windup keeps the recovery from a saturated period clean.',
  },
  worstPm: {
    what: 'Phase margin: how much extra phase lag (for example extra dead time) the loop can take before it goes unstable.',
    how: String.raw`From the linearized loop $L(j\omega) = C(j\omega)\,G(j\omega)$, including the transport delay and half a controller cycle, at the frequency $\omega_c$ where $|L| = 1$:

$$\text{PM} = 180^\circ + \angle L(j\omega_c)$$

Worked out at each operating point, and again for 20 random variations of the plant at each one (see "the spread" below). The scorecard shows the smallest. In cascade, the smaller of the master and slave loops.`,
    good: '45–60° or more is comfortable; under 30° the loop rings.',
    improve: 'Less gain, or less phase lag: shorter dead time, faster valve or transmitter, derivative action.',
  },
  worstGm: {
    what: 'Gain margin: how much the loop gain could grow (the process gain drifting up, say) before the loop goes unstable.',
    how: String.raw`At the frequency $\omega_{180}$ where the phase of $L(j\omega)$ reaches −180°:

$$\text{GM} = -20\log_{10}|L(j\omega_{180})| \quad [\text{dB}]$$

Infinite if the phase never reaches −180°. Smallest over all operating points and plant variations, as for phase margin.`,
    good: '6 dB (a factor of 2) or more.',
    improve: 'Lower the gain. Processes whose gain changes across the range need gain scheduling or characterization to keep the margin everywhere.',
  },
  worstMs: {
    what: 'Peak sensitivity: the one-number robustness measure. It is how much the loop amplifies disturbances at its worst frequency, and the inverse of the closest the loop comes to the critical point −1.',
    how: String.raw`$$M_s = \max_\omega \left|\frac{1}{1 + L(j\omega)}\right|$$

Largest over all operating points and plant variations. It guarantees both margins at once:

$$\text{GM} \ge \frac{M_s}{M_s - 1}, \qquad \text{PM} \ge 2\arcsin\frac{1}{2M_s}$$`,
    good: 'Below 1.4 robust, 1.4–2 acceptable, above 2 fragile.',
    improve: 'Detune (lower gain, slower closed loop), or add phase lead with derivative. Auto-tune aims for about 1.4–1.6.',
  },
  stableAll: {
    what: 'Whether the loop stays stable for every plant in the spread, not just the nominal one.',
    how: String.raw`The linearized closed loop (with the delay as a second-order Padé approximation) is built for each operating point and each of the 20 random plant variations. "Yes" if every eigenvalue of every one has a negative real part.`,
    good: 'Yes. A "no" here is the most important line of the scorecard.',
    improve: 'Detune, or fix the cause of the variation: gain scheduling for gain that changes with the operating point, a better valve for one that changes with wear.',
  },
  tuningParams: {
    what: 'How many numbers someone has to choose — and keep right as the plant changes.',
    how: 'Counted from the controller: 1 for P, 2 for PI, 3 for PID; a schedule counts every breakpoint\'s gains plus its position; cascade counts both PIDs; each feedforward term adds 3 (gain, lead, lag).',
    good: 'As few as do the job.',
    improve: 'Only add structure (schedules, feedforward, cascade) where the tests show it pays.',
  },
  needsModel: {
    what: 'What the strategy needs to know about the process beyond a simple bump test.',
    how: 'A judgement per controller type, not a calculation: PID needs nothing more than a bump test; characterization needs the nonlinearity\'s formula; feedforward needs how the disturbance and the valve each move the PV.',
    good: 'Nothing beyond a bump test, unless the gain is worth it.',
    improve: 'Prefer strategies whose model comes from a balance (mass, energy) that holds over the plant\'s life over ones that depend on fitted numbers that drift.',
  },
  commissioning: {
    what: 'How much effort it takes to put the strategy into service on a real plant.',
    how: 'A judgement per controller type, 1–5: on-off and PI are a bump test and a tuning; PID needs the noise checked; feedforward and cascade need several tests in order; gain scheduling needs a bump test at every breakpoint.',
    good: 'Low, unless the performance gain is worth an engineer\'s days on site.',
    improve: 'Not adjustable: it is the price of the structure.',
  },
  maintainability: {
    what: 'How easily the plant\'s own technicians can understand, check and retune it after commissioning.',
    how: 'A judgement per controller type, 1–5: a single PID is something every instrument technician knows; schedules and multi-term feedforward need the engineer who designed them.',
    good: 'High. A strategy nobody on site understands gets switched to manual.',
    improve: 'Document it on the HMI (active gains, feedforward contribution), and keep structures standard (PID_Compact, PID_Temp) where they do the job.',
  },
};

/** Labels for the robustness spread, so the explanation can say what was varied. */
export const SPREAD_NOTE = 'The spread: for robustness, the plant parameters this process is uncertain about are each varied randomly (uniformly) within ± their spread, 20 times per operating point; the controller keeps its tuning.';
