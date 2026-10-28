import { DEFAULT_PID, type ControllerConfig, type ControllerKind } from './controllers';
import type { Params, ProcessId } from './model';

// The written side of Loop Lab: what each process and controller teaches from
// the mechanical, control and automation points of view, and the case
// studies. Markdown with $math$; String.raw keeps LaTeX backslashes intact.

export type ProcessContent = { mechanical: string; control: string; automation: string; commissioning: string[]; verdict: string };

export const PROCESS_CONTENT: Record<ProcessId, ProcessContent> = {
  flow: {
    mechanical: String.raw`Water comes from a pressure header (normally 5 bar), passes the control valve **FV-101** and a magnetic flowmeter **FT-101**, and discharges into a line at 1 bar.

**Hydraulics.** The valve passes $Q = K_v\,f(s)\,\sqrt{\Delta p_v}$ (m³/h, bar), where $f(s)$ is the inherent characteristic at stem position $s$. The pipe takes $\Delta p_{line} = k_L Q^2$, so the pressure left for the valve is $\Delta p_v = P_0 - P_b - k_L Q^2$. Solving the two together:

$$Q = K_v f(s)\sqrt{\frac{P_0 - P_b}{1 + K_v^2 f(s)^2 k_L}}$$

**Installed characteristic and authority.** As the valve opens, more pressure is lost in the line and less is left across the valve, so the *installed* curve bends away from the inherent one. The ratio of valve drop to total drop at full flow, the valve authority, sets how much. With an authority around 0.3, as here, an equal-percentage trim installs as a nearly straight line, and a linear trim installs like a quick-opening one. This is the reason equal-percentage trims are the default for flow loops.

**Dynamics.** The water column's inertia gives a time constant of $\tau_f = \rho L Q / (2 A\,\Delta p)$, about 0.1 s for 50 m of DN100 pipe. That is far faster than the actuator (about 1.5 s) and the transmitter damping (0.5 s), so the flow simply follows the valve. The loop's speed is set by the instruments, not the process.

**When the hardware is the problem.**
- An oversized valve works near its seat, where the gain is high and the resolution poor.
- A worn positioner or tight packing adds deadband, and the loop then cycles whatever the tuning.
- Too little straight pipe upstream of the meter makes the reading noisy.`,
    control: String.raw`Linearized at an operating point, the loop sees a stable, low-order process:

$$G(s) = \frac{K}{(\tau_v s + 1)(\tau_m s + 1)}\,e^{-\theta s}$$

Here $K$ is the slope of the installed characteristic (% of span per % of valve), $\tau_v$ the actuator lag, $\tau_m$ the transmitter damping, and $\theta$ only the half cycle of the digital controller.

**Why PI is the right answer.**
- **Dead time is tiny**, so the loop could be made very fast. The real limit is noise and valve wear, not stability.
- **Integral action is essential.** The process is self-regulating, so P-only would leave an offset.
- **Derivative only adds noise.** Its high-frequency gain is $K_c(1 + 1/a)$, about 11 × $K_c$ with $a = 0.1$, applied to a reading that is mostly turbulence. A process that is first-order apart from small lags has no phase to recover.
- **A Lambda-tuned PI with $T_i \approx \tau_v$** cancels the dominant lag. Choose $\lambda$ for how hard you want to drive the valve. The result is a smooth first-order response with no overshoot.

The gain changes a little across the range (the installed curve isn't perfectly straight), but the margins stay large everywhere, so one tuning works.`,
    automation: String.raw`**Tags.** FT-101 (magflow, 4–20 mA, 0–60 m³/h), FIC-101 (the controller), FV-101 (globe valve with a positioner).

**Siemens.**
- **PID_Compact** in a cyclic interrupt **OB30** at 100 ms. A flow loop's dominant lag is about 1.5 s, so 100 ms gives the ten-plus samples per time constant you want.
- Set the damping in the **transmitter**, not with a PLC filter, so the controller sees the same signal as the HMI.
- **Scaling:** PID_Compact works in engineering units, so its gain is in %/(m³/h). Kc = 0.45 in % of span becomes Gain = 0.45 × 100 / 60 = 0.75.
- **Pretuning:** PID_Compact's pretuning and fine tuning work on flow loops, but they tend to come out aggressive. A Lambda tuning from a manual bump test is easier to defend.

**Elsewhere.**
- A DCS typically runs flow loops at 250–500 ms. That is still fine, because 500 ms is well under the 1.5 s valve lag.
- Rockwell's PIDE in dependent-gains mode uses the same ideal form, but expresses reset and rate in **minutes**.`,
    commissioning: [
      'Check the flowmeter zero with the line full and the valve shut, and that flow reads positive in the right direction.',
      'Stroke the valve in manual (0, 25, 50, 75, 100 %) and compare the position feedback; note any deadband on reversals.',
      'Bump test in manual: step the output 5 %, record gain and lag. Repeat at a low and a high flow.',
      'Tune (Lambda, λ ≈ 1–3 × the valve lag), close the loop, and check a setpoint step and a pump/header upset.',
      'Watch the valve for a while: a loop that is fine on the trend but strokes the valve constantly is tuned too hard for the noise.',
      'Set high/low flow alarms and a deviation alarm with a delay longer than one closed-loop response.',
    ],
    verdict: String.raw`**PI, and leave it there.** A Lambda- or SIMC-tuned PI with a moderate gain controls this loop well over the whole range and through header upsets. Derivative improves the scorecard by a few percent and more than doubles the valve travel. On-off cycles the valve hundreds of times an hour. If the loop misbehaves, look at the valve (deadband, sizing) before the controller.`,
  },
  tank: {
    mechanical: String.raw`A point-down conical vessel, 2 m tall, 0.15 m radius at the bottom and 1 m at the top. It is filled through **LV-201** and drained by gravity through a hand valve.

**Mass balance.** With the cross-section $A(h) = \pi\,r(h)^2$ and $r(h) = r_0 + (R - r_0)\,h/H$:

$$A(h)\,\frac{dh}{dt} = Q_{in} - Q_{out}, \qquad Q_{in} = Q_{max}\,f(s), \qquad Q_{out} = K_{out}\,d\,\sqrt{h}$$

The outlet is Torricelli flow through the hand valve at opening $d$.

**The nonlinearity.** One extra m³/h of inflow raises the level at $1/A(h)$. Between 0.4 m and 1.6 m the area grows about 6.7 times, so near the bottom the level moves almost seven times faster for the same valve change. The drain adds a second, milder effect: $Q_{out}$ grows with $\sqrt{h}$, which gives the process some self-regulation.

**Hardware alternatives.**
- A straight cylinder makes the problem disappear. Set $r_0 = R$ in the parameters to see this.
- Load cells measure mass, which is proportional to volume, so the controller would already see a linear process.
- A radar or DP level transmitter measures level, and so keeps the nonlinearity.`,
    control: String.raw`Linearizing at a level $h_0$:

$$\frac{h(s)}{Q_{in}(s)} = \frac{K(h_0)}{\tau(h_0)\,s + 1}, \qquad \tau(h_0) = \frac{2A(h_0)\sqrt{h_0}}{K_{out}d}, \qquad K(h_0) = \frac{2\sqrt{h_0}}{K_{out}d}$$

$\tau$ runs from about 4 minutes at 0.4 m to nearly an hour at 1.6 m, much longer than any loop you would tune. Over the loop's time scale the tank acts as an **integrator** with slope $k' = K/\tau = Q_{max}/(100\,A(h_0))$ (per % of valve).

**Why one PI tuning fails.** A PI on an integrator $k'/s$ gives the closed-loop characteristic equation

$$s^2 + k'K_c\,s + \frac{k'K_c}{T_i} = 0 \quad\Rightarrow\quad \zeta = \tfrac12\sqrt{k' K_c T_i}$$

With $K_c$ and $T_i$ fixed, damping falls with $\sqrt{k'}$. If you tune for $\zeta \approx 1$ at the bottom, the top of the tank sees $\zeta \approx 0.4$: it overshoots by about 25 % and rings slowly. If you tune for the top, the bottom gets a gain about 7 times higher than it needs, and the level noise goes straight to the valve.

**The fixes keep $k'K_c$ constant.**
- **Gain scheduling:** make $K_c \propto A(h)$.
- **Characterization:** control volume instead of level. $dV/dt = Q_{in} - Q_{out}$ has the same slope whatever the level, so a single PI tuning is right everywhere.`,
    automation: String.raw`**Tags.** LT-201 (level, 0–2 m), LIC-201 (the controller), LV-201 (inlet valve).

**Siemens.**
- **Cycle time:** OB30 at 500 ms is plenty, since the fastest closed-loop mode is minutes. 1–2 s would also be fine.
- **Gain scheduling:** PID_Compact holds a single parameter set. Either write Retain.CtrlParams.Gain from a lookup FC every cycle (test how your firmware handles changes in automatic), or use a custom SCL PID whose integral is kept in output units so gain changes don't bump. The export does the latter.
- **Characterization:** an FC computes volume from level, and PID_Compact's Input and Setpoint are both in m³. The HMI still shows level for the operators, and volume for the loop.

**Operator view.** Operators think in level, so the faceplate setpoint stays in metres and is converted inside the PLC. Alarms (high-high and low-low) should stay on the raw level, independent of the controller.`,
    commissioning: [
      'Check the level transmitter: dry tank reads 0, a known fill reads right (or calibrate against the strapping table).',
      'Confirm the inlet valve fails closed and LV-201 strokes fully.',
      'Bump test at three levels (low, middle, high): step the valve 5–10 % and measure the slope of the level ramp. The ratio between them is the gain variation you have to deal with.',
      'Decide the strategy from that ratio: within about 2:1 one PI is fine; beyond that schedule or characterize.',
      'Tune at each level (or once in volume units), then test setpoint steps and an outflow upset at the bottom and the top.',
      'Set high-high / low-low alarms and interlocks on the raw level, independent of the controller.',
    ],
    verdict: String.raw`**Characterize if you know the geometry; gain-schedule if you don't.** Controlling volume gives one PI tuning that is right from bottom to top, costs a single function block, and survives moderate geometry errors. Gain scheduling reaches the same result from bump tests at a few levels, without needing a formula, at the cost of more parameters to look after. A single PI is acceptable only if the level stays in a narrow band, or if slow control near the bottom (tuned for the top, detuned for noise) is good enough.`,
  },
  stirred: {
    mechanical: String.raw`A 200 L jacketed vessel with an agitator. Cold feed runs through it continuously, and **TV-401** sets how much heat goes into the jacket (hot water or low-pressure steam).

**Two energy balances in series.**

$$C_j\,\frac{dT_j}{dt} = Q_{max} f - UA\,(T_j - T), \qquad C_v\,\frac{dT}{dt} = \rho c_p F\,(T_{in} - T) + UA\,(T_j - T)$$

The heat goes first into the jacket, then through the wall into the contents. The contents are well mixed (that is what the agitator is for), so the vessel is one lumped temperature.

**Where the time goes.**
- The vessel's heat capacity ($\rho c_p V \approx 840$ kJ/K) against the feed and the jacket gives the slow time constant, about 14 minutes.
- The jacket ($C_j/UA \approx 40$ s) and the thermowell (15 s) add two smaller lags.
- There is almost no dead time: nothing is transported anywhere.

**When the hardware is the problem.**
- **Fouling** (scale on the jacket side) lowers UA. The process gets slower and the jacket lag grows.
- **A thermowell** that is long, thick-walled or badly placed (in a dead zone the agitator doesn't sweep) adds lag the controller can do nothing about.
- **The agitator stopping** changes everything: the vessel is no longer one temperature.`,
    control: String.raw`Linearized, the plant is three lags in series and essentially no dead time:

$$G(s) = \frac{K}{(\tau_1 s + 1)(\tau_2 s + 1)(\tau_m s + 1)}, \qquad \tau_1 \approx 840\text{ s},\ \tau_2 \approx 35\text{ s},\ \tau_m = 15\text{ s}$$

**Why derivative earns its keep here.** The phase lag of a PI loop comes mostly from the smaller lags. Derivative adds phase lead, of up to 90°, over a range of frequencies, which cancels much of that. With the lead in place, the gain can go up without losing margin. In the numbers:
- **PI at $K_c = 13.4$** has a phase margin of 37° and $M_s \approx 2$: fragile.
- **PID at the same gain** has a phase margin of about 58° and $M_s \approx 1.5$: robust.

SIMC's PID rule makes this explicit: with the second-order model, $T_d = \tau_2$ cancels the second lag.

**The price is noise.** The derivative's gain keeps rising with frequency until the filter stops it at $K_c(1 + 1/a)$. With $a = 0.1$ that is 11 × $K_c$ applied to the measurement noise. Raising the filter ratio to $a = 0.3$–$0.5$ keeps nearly all of the useful lead (the process lags are tens of seconds, the noise is per-sample) and cuts the valve activity about three times.

**One tuning everywhere.** Across the temperature range the plant doesn't change at all. The gain does fall with throughput ($K \propto 1/F$), but only 2:1 across the throughput test, which one robust tuning absorbs.`,
    automation: String.raw`**Tags.** TT-401 (RTD in a thermowell, 0–100 °C), TIC-401 (the controller), TV-401 (heating valve).

**Siemens.**
- **Block:** PID_Compact, or **PID_Temp** if the vessel also has cooling (heating/cooling split outputs with their own gains).
- **Cycle:** OB30 at 1 s is plenty for minute-scale dynamics.
- **Derivative filter:** set it with Retain.CtrlParams.TdFiltRatio (0.3–0.5). Use DWeighting = 0 so recipe setpoint steps don't kick the valve.
- **Pretuning** works well on processes like this (slow, self-regulating, little dead time).

**Elsewhere.** Temperature loops in batch reactors are the classic DCS use of PID with derivative. Many add a setpoint ramp, so heat-up follows a profile instead of a step.`,
    commissioning: [
      'Check the RTD against a reference thermometer at two temperatures; check the thermowell is in a well-mixed spot.',
      'With the agitator running and the feed steady, step the heating valve 5–10 % in manual and record the response for 3 time constants.',
      'Fit the second-order model (two lags): the smaller one sets Td.',
      'Tune PID with a derivative filter of 0.3–0.5 and DWeighting = 0; watch the valve for noise-driven movement.',
      'Test a feed temperature change and a throughput change; check the overshoot on a recipe setpoint step.',
      'Interlock the heating on agitator stop and on high-high temperature, outside the controller.',
    ],
    verdict: String.raw`**PID, derivative included, with its filter set sensibly.** Derivative cuts the worst upset by about a third and makes the loop more robust at the same time, because its phase lead pays for the extra gain. The cost is valve activity: about 4× a PI's with a filter ratio of 0.5, about 12× with 0.1. If the actuator can't take that, a SIMC-tuned PI is an honest second. Nothing further up the ladder is needed.`,
  },
  hx: {
    mechanical: String.raw`A shell-and-tube exchanger. Steam condenses on the shell side and heats a water stream inside the tubes. **FV-301** throttles the steam.

**Steam side.** At these pressures the steam valve runs at (near) critical flow, so the flow depends on the upstream pressure and the valve opening, not on what is downstream:

$$\dot m_s = K_{st}\, f(s)\, P_s$$

A 25 % drop in header pressure is a 25 % drop in steam flow at any valve position. The temperature only finds out later.

**Two energy balances.** All the steam condenses and heats the tube bundle, which heats the fluid:

$$C_w\frac{dT_w}{dt} = \frac{\dot m_s \lambda}{3600} - UA\,(T_w - T), \qquad C_f\frac{dT}{dt} = \rho c_p F\,(T_{in} - T) + UA\,(T_w - T)$$

**Where the time goes.** The fluid hold-up and the tube bundle give a dominant lag of about 30 s. TT-301 sits a few metres downstream, which adds 3 s of dead time, and the thermowell adds 4 s more.

**What is measured.**
- **FT-301:** steam flow.
- **FT-302:** process flow.
- **TT-302:** inlet temperature.

Each one, if used, takes one upset out of the temperature loop's hands.`,
    control: String.raw`**Three upsets, three paths.**
- **Steam pressure** acts on the steam flow, then through the wall to $T$. It passes through a variable you can measure and control fast.
- **Process flow and inlet temperature** act on $T$ directly, through the fluid balance. They are measured before they arrive.

**Cascade.** An inner loop on steam flow (valve → FT-301: about 2 s of valve and transmitter lag) is many times faster than the temperature. It corrects a pressure swing within seconds, before the wall has warmed or cooled. The outer loop then sees a near-ideal process:

$$T(s) \approx \frac{K}{(\tau s + 1)} e^{-\theta s}\cdot \dot m_{s,sp}(s)$$

That process is free of the pressure disturbance and of the valve's nonlinearity. Tune the inner loop first, then the outer with the inner closed. The inner loop should be 3–5× faster at least; here it is much more.

**Feedforward.** At steady state the energy balance says exactly how much steam a flow change needs:

$$\Delta \dot m_s = \frac{\rho c_p\, \Delta F\,(T - T_{in})\cdot 3600}{\lambda}, \qquad \Delta \dot m_s = -\frac{\rho c_p F\,\Delta T_{in} \cdot 3600}{\lambda}$$

In valve % (single loop), or in steam-flow setpoint (with cascade), that is the static feedforward gain.

**Dynamics.** The flow and inlet disturbances act on the fluid directly. The steam has to go through the wall first, so the disturbance path is a few seconds faster than the valve path. Feedforward can't anticipate that, so it can only partly cancel the upsets. The lead-lag ($\tau_u s + 1)/(\tau_d s + 1)$ comes out nearly 1 here, so a static gain does most of the work.`,
    automation: String.raw`**Tags.**
- Temperature loop: TT-301 → TIC-301 (master).
- Steam flow loop: FT-301 → FIC-301 (slave) → FV-301.
- Feedforward inputs: FT-302 and TT-302, combined in FY-302 (the calculation block).

**Siemens.**
- **Cascade:** **PID_Temp** supports cascade directly (master and slave configured to work together, including windup handling). With **PID_Compact**, use two instances. Scale the master's output to the slave's setpoint range, put the slave in automatic before the master, and stop the master integrating while the slave is at its limit. The exported LL_PID has HoldIntegral / AtLimit for exactly that.
- **Feedforward:** compute it in SCL from FT-302 and TT-302 (the exported LL_LeadLag), and add it to the slave setpoint (cascade) or to the PID output. Re-zero it on every switch to automatic.
- **Cycle:** both loops in the same OB30, slave after master, at 0.5 s or faster for the steam flow loop.

**Operator view.** Show both loops on the faceplate: the master's SP/PV and the slave's SP/PV. A slave left in manual (or local) silently breaks the cascade. Mode logic should force the master to track when the slave isn't in cascade mode.`,
    commissioning: [
      'Check FT-301 (steam flow) zero and span; a DP steam meter needs density compensation for pressure swings.',
      'Tune the steam flow loop first, on its own, in automatic with a local setpoint: fast and non-oscillating.',
      'Bump test the temperature with the steam flow loop closed (step its setpoint), and tune the master on that response.',
      'Put the slave in cascade mode, then the master in automatic; check bumpless transfer both ways.',
      'Commission feedforward last: start at 70–80 % of the calculated gain, step the process flow, and adjust until the temperature barely moves.',
      'Check what happens when FT-302 fails: feedforward should freeze or drop out, not slam the valve.',
    ],
    verdict: String.raw`**Cascade for the steam pressure, feedforward for the measured flow and inlet temperature, and both together if all three upsets matter.**
- Cascade cuts steam-pressure upsets from about 11 °C to under 1 °C.
- Feedforward cuts flow upsets from 13 °C to about 3 °C.
- Together, every upset stays under about 2.5 °C and the IAE drops by two thirds.

The price is three more transmitters' worth of trust, ten tuning numbers instead of two, and about 2.8× more valve activity. Each piece is worth adding only if its upset is big enough to matter in your plant.`,
  },
  custom: {
    mechanical: String.raw`This process has no physics behind it: it is a model identified from a trend of your own loop (the **Identify** tab).

The model has the form

$$G(s) = \frac{K\,e^{-\theta s}}{(\tau_1 s + 1)(\tau_2 s + 1)} \quad\text{or}\quad G(s) = \frac{k'\,e^{-\theta s}}{s\,(\tau s + 1)}$$

It includes everything the trend saw between the controller output and the measurement: valve, process and transmitter together. That's why the valve and transmitter lags here are kept tiny, so they aren't counted twice.

What the model can't tell you is *why* the loop behaves as it does. For that, go back to the plant:
- the valve's size and characteristic;
- where the sensor sits;
- what other users share the supply.`,
    control: String.raw`**The identified model is only valid near the operating point the trend was taken at.** Identify at two or three operating points, keep the fits, and compare the gains. If they differ by more than about 2:1, one tuning won't fit everywhere (see the conical tank).

**How far to trust it.**
- **Fit above 90 %** with a noise-like residual: the model has what there is to find.
- **Lower fit, or a slowly wandering residual:** something else moved during the test (an upset, a nonlinearity), or the model is too simple. Try second order, narrow the window, or repeat the test.

**The test scripts** are written in units of the model's own time scale ($\tau_1 + \tau_2 + \theta$), so they make sense for a 5-second flow loop and a 2-hour temperature loop alike. The **model mismatch** test is the one to watch: a tuning that only works if the model is exact won't work on the plant.`,
    automation: String.raw`**Getting a good trend from a Siemens PLC.**
- In TIA Portal, add a **Trace** on the PID instance (Input, Output; Setpoint optional), sampled at the OB cycle.
- Record in manual: steady first, then one or two output steps of 5–10 %, held until the PV settles.
- Export the trace as CSV. Semicolons and decimal commas are fine.

**Elsewhere.** Any historian or DCS trend export works, as long as the time, the controller output and the measurement are columns. Avoid heavy compression (deadband recording) in the historian: it hides the shape of the response.

The exported code and PID_Compact settings use your PV range, so check that the range in the Identify tab matches the transmitter's.`,
    commissioning: [
      'Make the bump test in manual, from a steady state, with nothing else changing; note the time of each step.',
      'Step big enough to be well above the noise (5–10 % of output), small enough to stay in the normal range.',
      'Hold each step until the PV settles (or, for an integrating process, long enough to see the ramp clearly).',
      'Identify, check the fit and the residual, and repeat the test at another operating point if the range is wide.',
      'Tune on the model, check the margins and the mismatch test here, then try it on the plant with a conservative speed first.',
    ],
    verdict: String.raw`**Whatever the tests say: this is your loop.** Start with a SIMC PI tuned on the identified model, check the mismatch test and the margins, and only climb the ladder if a specific upset or a varying gain demands it.`,
  },
};

export type ControllerContent = {
  summary: string;
  theory: string;
  works: string[];
  breaks: string[];
  tuning: string;
  implementation: string;
  siemens: string;
  broad: string;
};

export const CONTROLLER_CONTENT: Record<ControllerKind, ControllerContent> = {
  onoff: {
    summary: 'A relay: full output below the setpoint, none above, with a hysteresis band so it doesn\'t chatter. The simplest controller there is, and still the right one for thermostats, sump pumps and many heaters.',
    theory: String.raw`$$u = \begin{cases} u_{on} & e > b/2 \\ u_{off} & e < -b/2 \\ \text{unchanged} & \text{otherwise} \end{cases}$$

An on-off loop never settles: it **limit-cycles**. Each time the output switches, the process carries on moving for about one dead time before it notices. The swing is therefore roughly the hysteresis band plus what the process covers in that time: $\pm\big(b/2 + K\,\Delta u\,\theta/\tau\big)$.

The describing function of a relay, $N(a) = 4M/(\pi a)$, predicts where the cycle settles: where $G(j\omega) = -1/N(a)$.`,
    works: [
      'Slow processes with a lot of capacity, where a few percent of swing doesn\'t matter (room heating, tank top-up, sump pumps).',
      'Actuators that only have two states: contactors, solenoid valves, single-speed pumps.',
    ],
    breaks: [
      'Anything that needs to hold a value closely: it always cycles.',
      'Modulating valves and drives: switching between 0 and 100 % wears them out fast.',
      'Processes with dead time: the swing grows with θ/τ.',
    ],
    tuning: String.raw`There is only the hysteresis band, and it trades **swing** against **switching rate**. Widen it until the actuator's starts per hour are acceptable (motors and contactors have a rated number). For heaters, time-proportioning (PWM) turns the same relay into a proportional controller.`,
    implementation: String.raw`Compare against SP ± b/2 and **keep the state**: inside the band the output does not change. Add minimum on and off times for motors and compressors. Make the band large enough to cover the measurement noise, or noise alone will toggle the output.`,
    siemens: String.raw`A few lines of SCL or LAD with a set/reset (SR) bistable. For heaters on an S7-1200/1500, PID_Compact's **Output_PWM** or **CTRL_PWM** gives time-proportioning from a PID output instead.`,
    broad: String.raw`Every platform has a hysteresis/comparator block (CODESYS Util **HYSTERESIS**, for example). Building management systems run on-off with dead bands almost everywhere.`,
  },
  pid: {
    summary: 'Proportional, integral and derivative action on the error. Something like nine out of ten industrial loops are PI, and most of the rest are PID. The lab\'s baseline, and very often the verdict.',
    theory: String.raw`The ideal (ISA, non-interacting) form with setpoint weights, as PID_Compact implements it:

$$u = K_c\Big[(b\,r - y) + \frac{1}{T_i}\int (r - y)\,dt + T_d\,\frac{d}{dt}\Big(\frac{c\,r - y}{1 + a T_d s}\Big)\Big]$$

- **P** reacts to the error now. On its own it leaves an offset on a self-regulating process.
- **I** removes the offset by integrating until the error is zero. It adds phase lag below $\omega = 1/T_i$.
- **D** reacts to the error's rate of change and adds phase *lead*, which lets you raise the gain on lag-dominant processes. The filter $1/(1 + aT_d s)$ caps its high-frequency gain at $K_c(1 + 1/a)$.
- **Setpoint weights** $b$ and $c$ shape the response to setpoint changes without changing the response to disturbances. With $c = 0$ there is no derivative kick when the setpoint steps.

**Forms you will meet.**
- Parallel: $K_p = K_c$, $K_i = K_c/T_i$, $K_d = K_c T_d$.
- Series (interacting): $K_c'(1 + 1/T_i's)(1 + T_d's)$. Convert to ideal with $K_c = K_c'(1 + T_d'/T_i')$, $T_i = T_i' + T_d'$, $T_d = T_i'T_d'/(T_i' + T_d')$.

**In the frequency domain.** The loop is shaped so $|L(j\omega)|$ crosses 1 where the phase still has margin (PM ≥ 45°, GM ≥ 6 dB). Peak sensitivity $M_s = \max |1/(1 + L)|$ combines both: below 1.4 is robust, above 2 fragile.`,
    works: [
      'Self-regulating and integrating processes with modest dead time (θ/τ below about 1).',
      'Processes whose gain and dynamics stay roughly the same over the operating range.',
      'Most flow, pressure, temperature and level loops in a plant.',
    ],
    breaks: [
      'Gain or dynamics that change a lot across the range: one tuning cannot fit (→ gain scheduling, characterization).',
      'Dead time much longer than the time constant: the gain has to be cut so far that load rejection is slow (→ Smith predictor, IMC).',
      'Measured disturbances that hit faster than feedback can react (→ feedforward, cascade).',
      'Constraints and coupled variables (→ override, decoupling, MPC).',
    ],
    tuning: String.raw`1. **Bump test in manual.** Step the output 5–10 % and read off gain $K$, time constant $\tau$ and dead time $\theta$. The lab's linearization shows the same model.
2. **Pick a rule for what the loop is for.**
   - Lambda/IMC gives a smooth setpoint response with no overshoot.
   - SIMC with $\tau_c = \theta$ gives fast, still robust control. Use a larger $\tau_c$ to calm it.
   - AMIGO is a robust default for load rejection.
   - Ziegler–Nichols and Cohen–Coon are aggressive. They are good to recognise, but rarely what you want.
3. **Check robustness**, not just the step: margins, $M_s$, and the response with the plant changed by ±30 %.
4. **Check the valve.** CV activity and travel tell you whether noise is reaching the actuator.`,
    implementation: String.raw`**Discrete form** (called every $T_s$):
- Backward-Euler derivative on the filtered $c\,r - y$.
- Integral kept in **output units**, $I \mathrel{+}= K_c T_s e / T_i$, so changing gains online doesn't bump the output.

**Anti-windup.**
- Conditional integration: don't integrate further into a limit.
- Back-calculation: bleed the integral by $(u_{sat} - u)\,T_s/T_t$.

**Bumpless manual → auto.** In manual, keep setting $I = u_{manual} - P$ so the first automatic cycle starts from the manual output.

**Sample time.** At least 10 per dominant time constant, and under a fifth of the dead time if there is real dead time. Call the block from a fixed cyclic interrupt, never from the free-running main cycle.`,
    siemens: String.raw`- **PID_Compact** (continuous output, or PWM) is the standard choice.
- **PID_3Step** drives valve actuators with open/close outputs and no positioner.
- **PID_Temp** handles heating/cooling split outputs.
- Call them from **OB30–OB38** at a cycle that matches CtrlParams.Cycle.
- The gain is in engineering units (Gain = Kc × 100 / span when the input is scaled).
- Pretuning and fine tuning (relay-based) are available in the commissioning editor.
- The custom **LL_PID** export reproduces exactly the algorithm in the lab, for when you need back-calculation or online gain changes.`,
    broad: String.raw`- **CODESYS:** Util **PID** (KP, TN, TV in seconds).
- **TwinCAT:** Tc2_ControllerToolbox **FB_CTRL_PID**.
- **Rockwell PIDE:** independent or dependent gains, with times in minutes.
- **DCS (DeltaV, 800xA, Experion):** usually the ISA form with gain, reset and rate, sometimes as reset in repeats per minute.

Always check the form (ideal, series or parallel) and the time units before copying numbers between systems.`,
  },
  schedule: {
    summary: 'A PID whose gains are looked up from where the process is. You linearize at a few operating points, tune each one, and interpolate between them. The standard fix when a process\'s gain changes across its range.',
    theory: String.raw`If the plant near operating point $\rho$ behaves like $G_\rho(s)$, tune a controller $C_\rho(s)$ for each one, then let the gains follow a **scheduling variable** that tracks the operating point:

$$K_c(\rho),\ T_i(\rho),\ T_d(\rho) \quad\text{interpolated between breakpoints } \rho_1 < \rho_2 < \dots$$

**The "frozen" assumption.** Each local design assumes the gains stay put long enough for the loop to behave like its linear model. That requires the scheduling variable to change slowly compared with the closed-loop dynamics.

**Choosing the variable.**
- Schedule on **PV** when the nonlinearity lives in the process state (level in a cone).
- Schedule on **SP** when you want the gains to move ahead of the process on setpoint changes.
- Schedule on an **external measurement** (throughput, production rate) when that is what moves the dynamics.

Scheduling on PV closes an extra loop through the gains: fast PV swings make the gains swing too.`,
    works: [
      'Gain or time constants that change smoothly and predictably with a measurable variable.',
      'Plants you can bump-test at several operating points but have no formula for.',
      'A known operating schedule (throughput levels, product grades).',
    ],
    breaks: [
      'Scheduling variables that move as fast as the loop itself: the frozen assumption fails.',
      'Too few breakpoints over a strong nonlinearity: the interpolation is wrong in between.',
      'Gain changes that bump the output (the integral is not kept in output units).',
      'Maintenance: every breakpoint is a set of numbers someone has to understand and retune.',
    ],
    tuning: String.raw`1. Choose 3–5 operating points across the range, more where the gain changes fastest.
2. Bump test (or linearize) at each one and tune with the *same* rule and the same closed-loop speed, so the loop behaves the same everywhere.
3. Check the margins **between** breakpoints too, not just at them.
4. Run setpoint steps that cross breakpoints, and confirm there is no bump when the gains change.`,
    implementation: String.raw`- Interpolate linearly, and hold the end values flat outside the table.
- Keep the PID's integral in **output units** so a gain change doesn't move the output.
- Optionally rate-limit the scheduled gains.
- Log the active gains with the trend: it's the first thing you need when someone asks why the loop did something.`,
    siemens: String.raw`- **Lookup:** an FC interpolating over breakpoints (exported as **LL_Schedule**) writes Gain, Ti and Td into the PID instance every cycle.
- **With PID_Compact:** write Retain.CtrlParams, and test bumplessness on your firmware.
- **With the custom LL_PID:** the integral is already in output units, so gain changes don't bump.
- **Sharing:** store the breakpoints in a DB so they can be edited from the HMI by authorised users.`,
    broad: String.raw`Many DCS PID blocks have built-in gain scheduling, or "adaptive gain" tables keyed on an external variable. Flight control systems are the textbook case: schedules on dynamic pressure and Mach number.`,
  },
  characterized: {
    summary: 'Undo a known nonlinearity before the PID sees it, so that the controller faces a linear process. It works on the measurement (control volume instead of level) or on the output (the inverse valve characteristic).',
    theory: String.raw`If the process is a known static nonlinearity in series with something linear, invert the nonlinearity.

- **On the measurement:** control $y' = f(y)$ instead of $y$, with the setpoint converted the same way. In the conical tank, $V(h)$ turns $A(h)\,\dot h = Q_{in} - Q_{out}$ into $\dot V = Q_{in} - Q_{out}$, whose gain doesn't depend on level.
- **On the output:** send $s = g^{-1}(v)$ to the actuator. The controller asks for a flow fraction $v$ and gets it whatever the valve's inherent curve.

The PID then sees an approximately linear process and **one** tuning applies everywhere. Unlike scheduling, it adds no dynamics of its own and no extra loop through the gains.`,
    works: [
      'Nonlinearities that are static and known: vessel geometry, valve characteristics, the square root of a DP flowmeter, a titration curve.',
      'When the nonlinear function is well defined, but bump tests at many points are impractical.',
    ],
    breaks: [
      'Nonlinearities that are dynamic or unknown.',
      'Wrong models: the inversion is only as good as the formula (see the mismatch test).',
      'Near flat spots ($f\' \to 0$) the inverse has huge gain and amplifies noise.',
      'Output characterization inverts the inherent curve, not the installed one, so line losses remain.',
    ],
    tuning: String.raw`1. Put the characterization in first, then bump-test **in the characterized units**: the gain should now be the same at every operating point.
2. Tune one PI with your usual rule.
3. Test at the extremes of the range, and with the model deliberately off by 10–20 %.`,
    implementation: String.raw`- Write the function as a small FC with clamped inputs.
- Apply the same function to the setpoint as to the measurement.
- Display both raw and characterized values on the HMI, so operators and engineers each see their own units.
- Alarms belong on the raw measurement.`,
    siemens: String.raw`- **Volume from level:** an FC (exported as **LL_TankVolume**) computes it, and PID_Compact's Input and Setpoint are the volumes.
- **Valve linearization:** an FC between the PID output and the analog output.
- **Strapping tables:** TIA has no built-in table block, so use an FC with an interpolation table, or **SCALE_X** segments.`,
    broad: String.raw`- **DCS:** most have "characterizer" function blocks (piecewise-linear tables) for exactly this.
- **Valves:** smart positioners often have selectable characterization curves, which do the same thing in the field device.`,
  },
  feedforward: {
    summary: 'Act on a disturbance as soon as it is measured, before it moves the PV. Feedback still runs alongside to clean up what the feedforward gets wrong.',
    theory: String.raw`If a measured disturbance $d$ reaches the PV through $G_d(s)$ and the valve through $G_u(s)$, the output that cancels it exactly is

$$u_{ff} = -\frac{G_d(s)}{G_u(s)}\,d$$

With first-order-plus-dead-time models of both paths, that becomes a gain, a lead-lag and (sometimes) a delay:

$$u_{ff} = -\frac{K_d}{K_u}\cdot\frac{\tau_u s + 1}{\tau_d s + 1}\cdot e^{-(\theta_d - \theta_u)s}\, d$$

- **Static feedforward** (the gain alone) gets the steady state right. It is often enough, and it comes straight from a mass or energy balance.
- **Lead-lag** fixes the timing when the two paths have different speeds.
- **If $\theta_d < \theta_u$** the ideal feedforward would need to see the future. It can only be partly cancelled, and feedback has to do the rest.

**Stability.** Feedforward is outside the loop, so it doesn't change the stability margins at all. A wrong feedforward makes the response worse, never unstable.`,
    works: [
      'Big, frequent disturbances that can be measured upstream: throughput, feed temperature, feed composition.',
      'Processes with dead time, where feedback alone reacts too late.',
      'Where a balance (mass, energy) gives the gain without any test.',
    ],
    breaks: [
      'Unmeasured disturbances: there is nothing to feed forward.',
      'Disturbances that reach the PV faster than the valve can: only partial cancellation.',
      'Wrong or drifting models: fouling, valve wear, a mis-ranged transmitter. Too much feedforward makes upsets worse.',
      'A failed transmitter: feedforward follows the bad reading straight into the valve.',
    ],
    tuning: String.raw`1. **Static gain first:** from a balance, or from two bump tests (output step → PV, disturbance step → PV) as $-K_d/K_u$. Start at 70–80 % of it.
2. **Lead-lag:** lead = $\tau_u$, lag = $\tau_d$. If they are close, leave both at zero.
3. **Test with real disturbance steps,** with feedback in automatic.
   - The PV first dips, then rises: the timing is wrong.
   - The PV ends up away from setpoint while feedback catches up: the gain is wrong.
4. Re-check after maintenance: feedforward gains drift with the plant.`,
    implementation: String.raw`- Use the **deviation** from the disturbance value when the loop went to automatic, so switching on is bumpless.
- Add the feedforward to the PID output inside the anti-windup (the integral sees the total output), or to a cascade slave's setpoint.
- Re-zero in manual, limit its contribution, and freeze it on a bad-quality input.
- Discretize the lead-lag with backward Euler at the controller cycle.`,
    siemens: String.raw`- **PID_Compact:** newer versions have a **Disturbance** input added to the output; check your version.
- **Otherwise:** compute the feedforward in SCL (the exported **LL_LeadLag** block) and add it through LL_PID's Feedforward input, or to the cascade slave's setpoint.
- **Bad quality:** use the analog input's status (or the PROFINET IO status) to freeze the feedforward.`,
    broad: String.raw`- **DCS:** most PID blocks have a feedforward input with its own gain, and many have lead-lag blocks for the dynamic part.
- **Rockwell:** the PIDE instruction has a feedforward input.
- **Ratio control** is the common special case: a flow kept in proportion to another (fuel to air, additive to main flow) is feedforward with a gain set by the ratio.`,
  },
  cascade: {
    summary: 'Two loops nested: a fast inner (slave) loop on a variable between the valve and the PV, and an outer (master) loop that sets the slave\'s setpoint. Upsets that pass through the inner variable are corrected before they reach the PV.',
    theory: String.raw`The master controls the main PV. Its output is the slave's setpoint, and the slave controls a faster intermediate variable, here steam flow, by moving the valve.

**What it buys.**
- **Inner upsets are fixed early.** Anything that disturbs the inner variable (supply pressure, a valve that sticks) is corrected by the slave before it reaches the main PV.
- **The master sees a simpler process.** With the slave closed, the valve's nonlinearity, stiction and supply variations disappear inside it. The master sees "steam flow → temperature", which is cleaner than "valve position → temperature".

**What it needs.**
- The slave must be clearly faster than the master: a crossover 3–5× higher at least. Otherwise the two loops fight.
- The inner variable must be measurable, and reached by the valve before the outer variable.

**In the frequency domain.** The master sees $C_i G_2/(1 + C_i G_2)$, the slave's closed loop, in series with the path to the PV. At frequencies well below the slave's bandwidth that is close to 1: the master doesn't see the inner dynamics.`,
    works: [
      'An upset enters through a fast, measurable intermediate variable: supply pressure → flow, a jacket temperature, a motor current.',
      'The valve or actuator is nonlinear or sticky: an inner flow or position loop straightens it out.',
      'Temperature, level and composition loops whose valves have positioners or flow meters.',
    ],
    breaks: [
      'The inner loop is not much faster than the outer: they interact, and the result is worse than one loop.',
      'Upsets that bypass the inner variable (process flow, inlet temperature here): cascade does nothing for them.',
      'Windup through the cascade: if the master keeps integrating while the slave is saturated, the recovery overshoots.',
      'Mode handling: a slave left in manual or local setpoint silently breaks the loop.',
    ],
    tuning: String.raw`1. **Slave first,** on its own, with a local setpoint: fast and well damped (SIMC with $\tau_c \approx \theta$ is usually fine for a flow loop).
2. **Close the slave.** Bump-test the master by stepping the slave's setpoint, and fit a model to that response.
3. **Tune the master** on that model, more slowly: its crossover well below the slave's.
4. **Check both loops' margins:** the analysis here shows them separately.`,
    implementation: String.raw`- Scale the master's output (0–100 %) to the slave's setpoint range.
- Run the slave after the master in the same cycle, or in a faster cyclic interrupt.
- **Manual mode:** the master tracks the slave's measurement, so switching to automatic is bumpless.
- **Windup:** stop the master integrating in a direction where the slave is saturated (external reset feedback does this more elegantly).
- **Feedforward** for a cascade usually goes into the slave's setpoint.`,
    siemens: String.raw`- **PID_Temp** supports cascade directly: master and slave configured to work together, including what happens when the slave can't follow.
- **PID_Compact:** two instances. Master Output → scaled → slave Setpoint, and handle the master's windup when the slave is at a limit. The exported LL_PID has HoldIntegral and AtLimit for this.
- **HMI:** show both loops on the faceplate, with the slave's mode visible.`,
    broad: String.raw`- **DCS PID blocks** have a cascade mode (often called CAS). The slave sends its actual setpoint back (back-calculation) so the master can initialise and avoid windup.
- **Motion control** is cascade throughout: current inside velocity inside position, each loop several times faster than the one outside it.`,
  },
};

// ─── Case studies ───────────────────────────────────────────────────────────

export type CasePreset = {
  label: string;
  controller: ControllerConfig;
  /** Parameter changes on top of the process defaults. */
  params?: Partial<Params>;
};

export type CaseStep = {
  title: string;
  body: string;
  /** Runs shown under this step: each preset through the listed test scripts. */
  presets?: CasePreset[];
  scenarios?: string[];
  /** Extra panels: the plant linearized across the range, or linear step responses at each operating point. */
  show?: ('linearization' | 'operating-points')[];
};

export type CaseStudy = {
  id: string;
  process: ProcessId;
  title: string;
  question: string;
  family: 'pid-wins' | 'escalation';
  steps: CaseStep[];
};

const PI = (Kc: number, Ti: number, extra: Partial<typeof DEFAULT_PID> = {}): ControllerConfig => ({ kind: 'pid', pid: { ...DEFAULT_PID, Kc, Ti, ...extra } });

export const CASES: CaseStudy[] = [
  {
    id: 'flow-pi',
    process: 'flow',
    title: 'The flow loop: when PI is the answer',
    question: 'Can anything beat a well-tuned PI on a fast, noisy flow loop, and what would it cost?',
    family: 'pid-wins',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A header supplies water through FV-101 and a magflow FT-101. Operators move the setpoint between about 15 and 45 m³/h, and other users on the header pull its pressure around. The physics is in the **mechanical view**: an equal-percentage valve with low authority installs nearly linear, and the water's inertia is negligible. The loop's dynamics are the actuator (1.5 s) and the transmitter (0.5 s).`,
      },
      {
        title: 'Start crude: on-off',
        body: String.raw`The cheapest controller there is. Watch the valve column: it swings between shut and wide open, the flow cycles around the setpoint, and the valve travels hundreds of strokes an hour. That is fine for a sump pump, and not for a control valve.`,
        presets: [{ label: 'On-off, 2 % band', controller: { kind: 'onoff', hyst: 2, outOn: 100, outOff: 0 } }],
        scenarios: ['sp-steps'],
      },
      {
        title: 'A PI by the Lambda method',
        body: String.raw`The bump test (or the **control view**'s linearization) gives $K \approx 1.6$, $\tau \approx 1.75$ s and $\theta \approx 0.3$ s. Lambda tuning with $T_i = \tau$ cancels the valve lag, and $\lambda \approx 2$ s gives $K_c \approx 0.45$. The result is clean first-order responses, header upsets rejected within seconds, and moderate valve travel.`,
        presets: [{ label: 'PI (Lambda)', controller: PI(0.45, 1.8) }],
        scenarios: ['sp-steps', 'header-upset'],
      },
      {
        title: 'Push harder: SIMC with τc = θ',
        body: String.raw`The "as fast as robustly possible" setting quadruples the gain. IAE improves, but look at the cost: the noise on the reading now reaches the valve (CV activity about 4×, valve travel about 2.5×), and the setpoint steps overshoot by up to a third. Small dead time means you *can* tune fast, but noise and wear mean you usually shouldn't.`,
        presets: [{ label: 'PI (Lambda)', controller: PI(0.45, 1.8) }, { label: 'PI (SIMC, τc = θ)', controller: PI(1.8, 1.75) }],
        scenarios: ['sp-steps', 'header-upset'],
      },
      {
        title: 'Add derivative?',
        body: String.raw`Derivative adds phase lead, but this process has very little lag to recover. Its filter-limited high-frequency gain multiplies the measurement noise: the scorecard improves by a few percent while valve travel more than doubles. On a flow loop D is almost always off.`,
        presets: [{ label: 'PI (Lambda)', controller: PI(0.45, 1.8) }, { label: 'PID', controller: PI(0.6, 1.8, { Td: 0.3 }) }],
        scenarios: ['sp-steps', 'header-upset'],
      },
      {
        title: 'When the valve is the problem',
        body: String.raw`A 1 % deadband and 2 % noise. With integral action, the controller slowly winds the output across the deadband, the valve jumps, the flow overshoots, and the cycle repeats: a **stick-slip limit cycle**. Lower gains only slow it down. The fix is mechanical (positioner, packing), which is why the commissioning checklist strokes the valve before tuning.`,
        presets: [{ label: 'PI (Lambda)', controller: PI(0.45, 1.8) }],
        scenarios: ['noisy-sticky'],
      },
      {
        title: 'Verdict',
        body: String.raw`**PI, Lambda- or SIMC-tuned with a moderate gain.**
- Nothing on the controller ladder buys enough to justify its complexity here.
- Effort is better spent on the valve: sizing, deadband, positioner.
- Keep the gain where the valve isn't chasing noise.`,
      },
    ],
  },
  {
    id: 'tank-schedule',
    process: 'tank',
    title: 'The conical tank: when one tuning isn\'t enough',
    question: 'The process gain changes about 7× from bottom to top. What does that do to a PI loop, and which fix is worth it?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A point-down cone, filled through LV-201 and drained by gravity. The level has to be held anywhere from 0.3 to 1.7 m as production changes. The **mechanical view** shows why this is hard: the cross-section grows about 6.7× between 0.4 m and 1.6 m, so the same valve change moves the level 6.7× slower near the top.`,
      },
      {
        title: 'Baseline: one PI, tuned where it was commissioned',
        body: String.raw`Commissioning happened at low level, so the bump test there gives $k' \approx 5.2\times10^{-3}$ %/s per %. SIMC with $\tau_c = 60$ s gives $K_c \approx 3$ and $T_i \approx 245$ s. Near the bottom it's a good loop. Going up the tank, the same tuning gets sluggish and then overshoots by almost 20 %, ringing for half an hour.`,
        presets: [{ label: 'PI tuned at 0.4 m', controller: PI(3, 245) }],
        scenarios: ['sp-range', 'dist-low', 'dist-high'],
      },
      {
        title: 'Diagnose: the plant across the range',
        body: String.raw`Linearize at 0.4, 1.0 and 1.6 m. The time constant runs from 4 minutes to nearly an hour, but more importantly the integrating slope $k'$ falls by about 7×. For PI on an integrator, $\zeta = \tfrac12\sqrt{k'K_cT_i}$: the damping falls with $\sqrt{k'}$, from about 1 at the bottom to about 0.4 at the top. The linear step responses at the three levels show the same thing.`,
        show: ['linearization', 'operating-points'],
        presets: [{ label: 'PI tuned at 0.4 m', controller: PI(3, 245) }],
      },
      {
        title: 'Retune for the top?',
        body: String.raw`Tuning at 1.6 m gives $K_c \approx 20$. Now the top behaves, but the bottom gets about 7× more gain than it needs. The level noise reaches the valve (CV activity about 6×, travel about 5×) and the gain margin halves. One tuning can only be right in one place.`,
        presets: [{ label: 'PI tuned at 0.4 m', controller: PI(3, 245) }, { label: 'PI tuned at 1.6 m', controller: PI(20, 245) }],
        scenarios: ['sp-range', 'dist-low', 'dist-high'],
      },
      {
        title: 'Gain scheduling',
        body: String.raw`Tune at each of the three levels with the same rule and speed ($K_c$ = 3, 9.8 and 20), and interpolate on PV. Now the damping is the same everywhere: no overshoot at the top, and no extra noise at the bottom compared with the low-tuned PI. The cost is 9 numbers instead of 2, and three bump tests to get them.`,
        presets: [
          { label: 'PI tuned at 0.4 m', controller: PI(3, 245) },
          { label: 'Gain-scheduled PI', controller: { kind: 'schedule', pid: { ...DEFAULT_PID, Kc: 3, Ti: 245 }, on: 'pv', points: [{ at: 0.4, Kc: 3, Ti: 245, Td: 0 }, { at: 1.0, Kc: 9.8, Ti: 245, Td: 0 }, { at: 1.6, Kc: 20, Ti: 245, Td: 0 }] } },
        ],
        scenarios: ['sp-range', 'dist-low', 'dist-high'],
      },
      {
        title: 'Characterization: control volume',
        body: String.raw`The geometry is known, so convert level to volume and control that. $\dot V = Q_{in} - Q_{out}$ has the same slope at every level, so one PI ($K_c \approx 11.6$, $T_i \approx 255$ s in volume units) matches the schedule's performance with two parameters and one small function.`,
        presets: [
          { label: 'Gain-scheduled PI', controller: { kind: 'schedule', pid: { ...DEFAULT_PID, Kc: 3, Ti: 245 }, on: 'pv', points: [{ at: 0.4, Kc: 3, Ti: 245, Td: 0 }, { at: 1.0, Kc: 9.8, Ti: 245, Td: 0 }, { at: 1.6, Kc: 20, Ti: 245, Td: 0 }] } },
          { label: 'PI on volume', controller: { kind: 'characterized', pid: { ...DEFAULT_PID, Kc: 11.6, Ti: 255 }, char: 'volume' } },
        ],
        scenarios: ['sp-range', 'dist-low', 'dist-high'],
      },
      {
        title: 'What if the drawings are wrong?',
        body: String.raw`The tank is actually 15 % wider and the outlet partly blocked. The characterization uses the drawing's geometry, so its volumes are off. It degrades gracefully, because a 15 % gain error is well inside its margins. The schedule never knew the geometry, so it is just as unaffected. Both are robust here. A much larger error, or a strange vessel shape, would favour scheduling from real bump tests.`,
        presets: [
          { label: 'Gain-scheduled PI', controller: { kind: 'schedule', pid: { ...DEFAULT_PID, Kc: 3, Ti: 245 }, on: 'pv', points: [{ at: 0.4, Kc: 3, Ti: 245, Td: 0 }, { at: 1.0, Kc: 9.8, Ti: 245, Td: 0 }, { at: 1.6, Kc: 20, Ti: 245, Td: 0 }] } },
          { label: 'PI on volume', controller: { kind: 'characterized', pid: { ...DEFAULT_PID, Kc: 11.6, Ti: 255 }, char: 'volume' } },
        ],
        scenarios: ['mismatch'],
      },
      {
        title: 'Verdict',
        body: String.raw`**Characterize when the nonlinearity has a formula; schedule when it doesn't.**
- Volume control is the cheapest complete fix: one PI, one FC, robust to moderate geometry errors.
- Gain scheduling gets the same result from plant data alone, at the price of more parameters to maintain.
- A single PI is only acceptable over a narrow level band.

**Next on the ladder.** If this were a surge tank, the right answer would be the opposite of tight control: averaging level control (phase 3).`,
      },
    ],
  },
  {
    id: 'stirred-pid',
    process: 'stirred',
    title: 'The stirred tank: when derivative earns its keep',
    question: 'On the flow loop derivative only added noise. On a lag-dominant vessel, does D finally pay for itself?',
    family: 'pid-wins',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A 200 L jacketed vessel, agitated, with cold feed running through it. TV-401 heats the jacket, and TT-401 sits in a thermowell. Three lags in series (vessel about 14 minutes, jacket about 35 s, thermowell 15 s) and practically no dead time: the **control view** shows the plant. Recipe changes move the setpoint; upstream changes the feed temperature and the throughput.`,
      },
      {
        title: 'On-off, like a thermostat',
        body: String.raw`A thermostat works for a room. Here it overshoots recipe steps by up to 22 % and never settles, because by the time the heating switches off the jacket is already hot. On-off is fine where a few degrees of swing don't matter; for a reactor recipe they do.`,
        presets: [{ label: 'On-off', controller: { kind: 'onoff', hyst: 2, outOn: 100, outOff: 0 } }],
        scenarios: ['sp-steps'],
      },
      {
        title: 'A SIMC PI',
        body: String.raw`The bump test gives roughly $K \approx 0.86$, $\tau \approx 850$ s and $\theta \approx 36$ s effective (the small lags lumped together by the half rule). SIMC with $\tau_c = 2\theta$ gives $K_c \approx 9$, $T_i \approx 430$ s. The setpoint steps come in without overshoot. Feed upsets peak at about 3 °C and take around 9 minutes to recover. It's a respectable loop, robust at $M_s \approx 1.6$.`,
        presets: [{ label: 'PI (SIMC)', controller: PI(9, 430) }],
        scenarios: ['sp-steps', 'feed-temp', 'feed-flow'],
      },
      {
        title: 'Why not just more gain?',
        body: String.raw`Push the PI to $K_c \approx 13.4$ and the upsets shrink, but the phase margin falls to about 37° and $M_s$ passes 2. The model-mismatch test (a fouled jacket) overshoots by 9 %. The small lags are eating the phase: a PI can't go faster without becoming fragile.`,
        presets: [{ label: 'PI (SIMC)', controller: PI(9, 430) }, { label: 'PI, gain pushed', controller: PI(13.4, 373) }],
        scenarios: ['feed-temp', 'mismatch'],
      },
      {
        title: 'Add derivative',
        body: String.raw`SIMC's PID rule uses the second-order model: $T_d$ cancels the jacket lag. At the same gain the loop is now robust ($M_s \approx 1.5$, phase margin about 58°). The worst upset drops from 3.2 °C to about 2.1 °C, and recovery is two and a half minutes faster. This is what derivative is for: its phase lead pays for the gain.`,
        presets: [
          { label: 'PI (SIMC)', controller: PI(9, 430) },
          { label: 'PI, gain pushed', controller: PI(13.4, 373) },
          { label: 'PID (SIMC, a = 0.5)', controller: PI(13.4, 373, { Td: 37.5, a: 0.5 }) },
        ],
        scenarios: ['feed-temp', 'feed-flow', 'mismatch'],
      },
      {
        title: 'The price: filter the derivative',
        body: String.raw`With the default filter ratio $a = 0.1$ the derivative's high-frequency gain is 11 × $K_c$. The valve moves about 12 times as much as with the PI, and on the noisy-thermocouple test much more. Raising $a$ to 0.5 keeps nearly all the benefit (the process lags are tens of seconds; the noise is per-sample) at about 4 times the PI's activity. In PID_Compact that is Retain.CtrlParams.TdFiltRatio.`,
        presets: [
          { label: 'PID (SIMC, a = 0.1)', controller: PI(13.4, 373, { Td: 37.5, a: 0.1 }) },
          { label: 'PID (SIMC, a = 0.5)', controller: PI(13.4, 373, { Td: 37.5, a: 0.5 }) },
        ],
        scenarios: ['noisy', 'feed-temp'],
      },
      {
        title: 'Verdict',
        body: String.raw`**PID with a filtered derivative.**
- On a lag-dominant process with several lags, derivative is worth having: smaller upsets *and* more margin.
- Set the filter ratio to 0.3–0.5 and DWeighting to 0.
- If the valve can't take the extra movement, the SIMC PI is a respectable second.
- Nothing further up the ladder is needed.`,
      },
    ],
  },
  {
    id: 'hx-cascade-ff',
    process: 'hx',
    title: 'The heat exchanger: cascade and feedforward',
    question: 'Three upsets reach the outlet temperature by three different paths. Which tool fixes which, and is it worth the extra instruments?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`Steam heats a water stream in a shell-and-tube exchanger, and TT-301 reads the outlet a few metres downstream. Three things upset it:
- **Steam header pressure** swings. Steam flow follows instantly, because it is choked flow.
- **Process flow** changes with production; FT-302 measures it.
- **Inlet temperature** varies; TT-302 measures it.

The **mechanical view** shows why each one matters.`,
      },
      {
        title: 'Baseline: one PI on temperature',
        body: String.raw`SIMC on the bump test ($\tau \approx 29$ s, $\theta \approx 9$ s effective) gives $K_c \approx 1.5$, $T_i \approx 29$ s. Setpoint changes are clean. The upsets aren't: about 11 °C for a steam pressure drop, 13 °C for a flow step and 10 °C for a feed temperature step, each taking a minute and a half to recover. Feedback only hears about an upset once the temperature has moved.`,
        presets: [{ label: 'PI (SIMC)', controller: PI(1.5, 29) }],
        scenarios: ['steam-pressure', 'flow-upset', 'inlet-temp'],
      },
      {
        title: 'Cascade on steam flow',
        body: String.raw`Put a flow loop on the steam (FT-301 → FIC-301 → FV-301) and let the temperature controller set its setpoint.

**Tuning order.**
1. The slave first: its process is just the valve and the flow meter (about 2.5 s), so SIMC gives a fast PI ($K_c \approx 1.8$, $T_i \approx 2.3$ s).
2. Then the master, tuned on the response with the slave closed.

**Result.** A steam pressure swing now changes the flow for a few seconds before the slave puts it back, and the temperature barely moves: under 1 °C instead of 11 °C. The setpoint response gets faster too. But the flow and feed temperature upsets hardly change, because they don't pass through steam flow. The inner trend shows the slave at work.`,
        presets: [
          { label: 'PI (SIMC)', controller: PI(1.5, 29) },
          { label: 'Cascade', controller: { kind: 'cascade', outer: { ...DEFAULT_PID, Kc: 1.5, Ti: 31 }, inner: { ...DEFAULT_PID, Kc: 1.8, Ti: 2.25 }, ff: [] } },
        ],
        scenarios: ['steam-pressure', 'flow-upset', 'sp-steps'],
      },
      {
        title: 'Feedforward from flow and inlet temperature',
        body: String.raw`The energy balance says how much more steam a flow increase needs: $\Delta\dot m_s = \rho c_p\,\Delta F\,(T - T_{in})\cdot 3600/\lambda$. That is about 80 kg/h per m³/h, or 5 % of valve per m³/h; inlet temperature works the same way, at −1.24 % per °C. Both go straight to the valve, without cascade for now.

**Result.** Flow upsets drop from 13 °C to about 3 °C, and feed temperature upsets from 10 °C to under 3 °C. Steam pressure is exactly as bad as before, because nothing measures it.

**Why it isn't perfect.** The disturbances reach the outlet through the fluid, a few seconds sooner than steam can through the tube wall. Feedforward can't act before it knows, so a small upset remains. The "Design from model" button shows those numbers, and the control view plots the response with and without feedforward.`,
        presets: [
          { label: 'PI (SIMC)', controller: PI(1.5, 29) },
          { label: 'PI + feedforward', controller: { kind: 'feedforward', pid: { ...DEFAULT_PID, Kc: 1.5, Ti: 29 }, ff: [{ from: 'F', gain: 5, lead: 0, lag: 0 }, { from: 'Tin', gain: -1.24, lead: 0, lag: 0 }] } },
        ],
        scenarios: ['flow-upset', 'inlet-temp', 'steam-pressure'],
      },
      {
        title: 'Both together',
        body: String.raw`Cascade plus feedforward, with the feedforward going into the steam-flow setpoint. There its gain is in steam-flow units: 4 % of the 2000 kg/h span per m³/h, the same 80 kg/h per m³/h from the energy balance.

**Result.** Every upset now stays under about 2.5 °C, and the total IAE falls by about two thirds compared with the PI.

**The bill.**
- Three more transmitters to trust.
- Ten tuning numbers instead of two.
- About 2.8 times the valve activity.
- Commissioning that has to go in order: slave, master, then feedforward.`,
        presets: [
          { label: 'PI (SIMC)', controller: PI(1.5, 29) },
          { label: 'Cascade + feedforward', controller: { kind: 'cascade', outer: { ...DEFAULT_PID, Kc: 1.5, Ti: 31 }, inner: { ...DEFAULT_PID, Kc: 1.8, Ti: 2.25 }, ff: [{ from: 'F', gain: 4, lead: 0, lag: 0 }, { from: 'Tin', gain: -1, lead: 0, lag: 0 }] } },
        ],
        scenarios: ['steam-pressure', 'flow-upset', 'inlet-temp', 'mismatch'],
      },
      {
        title: 'Verdict',
        body: String.raw`**Match the tool to the path the upset takes.**
- **Cascade** when an upset passes through a fast, measurable intermediate variable, like steam flow here.
- **Feedforward** when an upset is measured before it arrives and a balance tells you its effect.
- **Both** only when each upset is big enough, in your plant, to pay for its transmitter and its tuning.

If the steam header is steady, the flow-and-feed feedforward alone is the cheaper win. If production is steady and the boiler isn't, cascade alone.`,
      },
    ],
  },
];

export const getCase = (id: string) => CASES.find((c) => c.id === id);
