import { DEFAULT_PID, defaultController, defaultCustomCode, type ControllerConfig, type ControllerKind } from './controllers';
import type { Params, ProcessId } from './model';
import { getProcess } from './processes';

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
  surge: {
    mechanical: String.raw`A buffer vessel, **T-601**, between two plant sections. The upstream section sends whatever it produces. Pump **P-601** draws the outflow through **LV-601** to the downstream section, which would rather see a steady feed.

**Mass balance.** With the outflow set by the pump and valve, not by the level:

$$A\frac{dh}{dt} = Q_{in} - Q_{out}, \qquad Q_{out} = Q_{max}\, f(s)$$

Nothing on the right depends on $h$, so the level is a pure integrator: any imbalance, however small, fills or empties the tank at a steady rate.

**The tank's room.** 4 m² of cross-section and 3 m of height hold 12 m³. At 1.5 m there are 6 m³ of room each way. A 15 m³/h upstream swing fills the room above the setpoint in 24 minutes. That volume is the tank's whole reason for existing.

**What goes wrong in practice.**
- Somebody tunes the level loop tightly, "because a level should be on setpoint", and the downstream section gets every upstream swing.
- The tank is then made bigger to fix the "surge problem", and the new tank does no better, because the controller still doesn't use it.`,
    control: String.raw`**An integrator with almost no dead time.** Valve to level:

$$G(s) = \frac{-k'}{s}\,e^{-\theta s},\qquad k' = \frac{Q_{max}}{100\,A}\cdot\frac{100}{H} \approx 0.0014\ \%/\text{s per }\%$$

The gain is negative (more outflow, lower level), so the controller acts in reverse.

**Two opposite goals.**
- **Tight level control** keeps $h$ on setpoint by moving $Q_{out}$ with $Q_{in}$. The outflow then copies every upstream swing.
- **Averaging level control** lets the level move within its limits so the outflow changes slowly. The tank absorbs the upset; the outflow only follows the *average* inflow.

**Choosing the speed from the room.** With the Lambda rule for integrating processes ($K_c = (2\lambda+\theta)/(k'(\lambda+\theta)^2)$, $T_i = 2\lambda + \theta$), a step $\Delta$ in inflow (in % of the outlet's capacity) moves the level by at most about

$$\Delta h_{max} \approx \frac{k'\,\Delta\,\lambda}{e}$$

before it turns round. So pick the largest swing you can tolerate and solve for the arrest time $\lambda$. Here, a 25 % inflow step using 25 % of the span gives $\lambda \approx 33$ min.

**P-only works.** An offset is harmless in a buffer. P-only with $K_c = 1/(k'\lambda)$ is even smoother, and it is what many plants use.`,
    automation: String.raw`**Tags.** LT-601 (radar or DP level, 0–3 m), LIC-601, LV-601 on the pump discharge.

**Siemens.**
- **PID_Compact** with **InvertControl = TRUE**: more output means more outflow and a lower level.
- A slow cycle is fine: OB30 at 1 s or slower. The loop's time scale is tens of minutes.
- Its pretuning will try to make the loop fast. For averaging control, enter the gains by hand.

**Protecting the limits.** Averaging control uses the tank's room on purpose, so the limits need their own protection:
- **High-level override** that opens the outlet, or a **high-high trip** that stops the feed.
- **Low-level** pump protection.
- Some plants use an error-squared or gap controller: very little action near the setpoint, strong action near the limits. PID_Compact doesn't do this; it is a few lines of SCL on the gain.

**Alarms.** Put level alarms at the real limits, not near the setpoint. An averaging level spends its life away from setpoint, and a deviation alarm would nag the operators all day.`,
    commissioning: [
      'Agree the level limits with operations first: how high and how low the level may go in normal running. That is the tuning spec.',
      'Check LT-601 reads the whole working range, and that the high and low alarms and trips are at the real limits.',
      'Measure k′: in manual, step the outflow 5 % and time the ramp (or calculate it from the tank area and the pump capacity).',
      'Choose the arrest time λ from the allowed swing and the largest normal upset, and compute Kc and Ti (or P-only).',
      'Watch a few days of upstream upsets: the outflow should drift, not jump, and the level should stay inside its limits.',
      'If the level hits a limit, slow down less (shorter λ) rather than adding derivative or tightening Ti.',
    ],
    verdict: String.raw`**A slow P or PI, tuned from the room the tank has.** The scorecard's IAE will call it terrible, and that's the wrong measure here: the outflow moves about eight times more gently than with a tight tuning, and the downstream section never sees the upstream swings. Protect the limits with an override or a trip, not by tightening the loop.`,
  },
  feeder: {
    mechanical: String.raw`A screw feeder under a hopper discharges bulk solids (limestone, say) onto a belt conveyor. A weigh idler near the far end of the belt, **WT-701**, measures the feed rate. The screw's motor runs on a VFD, **SC-701**, which the controller sets.

**The screw.** Its discharge follows its speed within a few seconds ($\tau_s \approx 4$ s, how the hopper flows and the flights fill):

$$\tau_s \frac{dF}{dt} = F_{max}\,\frac{n}{100}\,\frac{\rho}{\rho_0} - F$$

Bulk density $\rho$ changes with moisture, particle size and how full the hopper is. A wetter, lighter batch delivers less per turn.

**The belt.** Material takes $L/v$ to travel from the screw to the scale: here 30 s. That is pure transport delay. It is set by the layout and the belt speed, and nothing in the controller can shorten it.

**Where the time goes.** Valve (VFD ramp) 1 s, screw 4 s, belt 30 s, weighing filter 3 s. More than four fifths of the response time is dead time.

**Note on the scorecard.** Performance is judged on the rate leaving the screw: what the kiln will get, 30 s later.`,
    control: String.raw`**Dead-time dominant.** From speed to measured rate:

$$G(s) \approx \frac{K\,e^{-\theta s}}{\tau s + 1},\qquad K \approx 0.8,\ \tau \approx 5.5\ \text{s},\ \theta \approx 33\ \text{s}$$

With $\theta/\tau \approx 6$, this is the hard end of the scale.

**What feedback can do.** A PI can't respond to anything before $\theta$ has passed, and it must not push harder in the meantime. SIMC gives $T_i = \tau$ and $K_c = \tau/(K(\tau_c + \theta))$, with $\tau_c \ge \theta$ for robustness. The result is an almost pure integral controller, and a closed loop that settles in roughly $4\theta$.

**What a Smith predictor does.** It runs a model of the process beside the plant, $G_m(s) = K_m/(\tau_m s + 1)$, plus a copy delayed by $\theta_m$. It feeds the PI with

$$y_{fb} = y + G_m u - G_m e^{-\theta_m s} u$$

If the model is right, the delayed model output cancels the real measurement's response to the controller's own moves. The PI then sees the undelayed process $G_m$ and can be tuned for $\tau = 5.5$ s instead of $\theta = 33$ s. The setpoint response becomes "the fast response, $\theta$ later".

**What it can't do.**
- **Load upsets** (a density change) still reach the scale 30 s late, and nothing can act before then. Smith only helps the recovery.
- **Model error.** A wrong dead time leaves a mismatch term that acts like dead time the PI doesn't know about. A PI tuned too fast inside the predictor then rings.`,
    automation: String.raw`**Tags.** WT-701 (belt scale, 0–20 t/h), WIC-701, SC-701 (VFD speed reference, 0–100 %).

**Siemens.**
- **PID_Compact** in OB30. A 0.5 s cycle is plenty when the dead time is 30 s.
- PID_Compact has **no dead-time compensation**. Put the exported **LL_Smith** in front of it: it reads the scale and the PID's last output, and gives the PID a corrected input.
- The dead time in the model is a buffer of $\theta/T_s$ values (66 here). Keep the cycle constant (a cyclic interrupt, not OB1), or the buffer's length in time changes.

**Belt speed.** The belt is often on its own VFD. If its speed changes, the dead time changes with it. Calculate $\theta_m = L/v$ from the belt speed signal every cycle rather than typing in a constant.

**Weighing.**
- **Zero the belt scale** regularly, with the belt running empty: an offset is a permanent error in the feed rate.
- **Totalize** the rate for the batch record. Totalize the measured rate, not the setpoint.`,
    commissioning: [
      'Calibrate the belt scale: zero with the belt running empty, then span with a test chain or a weighed sample.',
      'Measure the dead time: step the screw speed in manual and time how long until the scale responds. Compare with belt length / belt speed.',
      'Bump test for the gain and the lag after the dead time. Repeat with a different material if the density varies a lot.',
      'Commission a PI first (τc ≈ θ). It is the fallback whenever the predictor is switched off.',
      'Then the Smith predictor: model from the bump test, PI tuned for the lag alone but no faster than about θ/2.',
      'Test with the belt slowed by 20 %: if the loop rings, make the PI inside the predictor slower, or tie the model dead time to the belt speed.',
    ],
    verdict: String.raw`**A PI tuned with $\tau_c \approx \theta$ is the honest baseline. A Smith predictor roughly halves the IAE**, mostly on setpoint changes: it settles in about 55 s instead of 90 s. It does little for density upsets, which nothing can see until they reach the scale.

It is worth it when rate changes are frequent and the dead time is known and stable. Tie the model's dead time to the belt speed if the belt can change speed. Tune the PI inside the predictor no faster than about half the dead time, or a slowed belt will make it ring.`,
  },
  drum: {
    mechanical: String.raw`The steam drum of a water-tube boiler. Water from the drum flows down the downcomers to the furnace, boils in the risers, and the steam-water mixture comes back to the drum, where steam separates and leaves through the top. **FV-502** controls the feedwater; **LT-501** reads the level, in mm from the normal water level (NWL).

**Why the level matters.**
- **Too high:** water carries over with the steam into the superheater and turbine.
- **Too low:** the risers starve and the tubes overheat.

Both are trips, typically at ±200–300 mm. The drum holds only a couple of minutes of steam production.

**The level is not just the water inventory.** The water below the surface is full of steam bubbles, so

$$L = L_w + L_{swell} - L_{shrink}$$

- **Water inventory:** $\rho A\,dL_w/dt = q_{fw} - q_s$, an integrator.
- **Swell:** more steam drawn drops the drum pressure, the water flashes, and the bubbles push the level up, although the drum is losing water.
- **Shrink:** more cold feedwater condenses bubbles, and the level drops, although the drum is gaining water.

Both effects are bigger at low pressure, where steam takes up more volume per kg.`,
    control: String.raw`**Inverse response on an integrator.** From feedwater to level:

$$\frac{L(s)}{q_{fw}(s)} = \frac{k}{s} - \frac{k_{sh}}{\tau_{sh}s + 1} = k\,\frac{1 - (k_{sh}/k - \tau_{sh})\,s}{s(\tau_{sh}s + 1)}$$

That is a zero in the right half plane at $1/(k_{sh}/k - \tau_{sh})$, about 35 s here. A right-half-plane zero limits bandwidth the way dead time does. The level loop can't be faster than about that time, whatever the tuning, so for tuning it counts as about 46 s of dead time. A model that keeps only the poles would say 11 s, and a PI tuned on it is fragile (Ms ≈ 6).

**Steam demand is the big upset**, and it enters with the wrong sign first. A level-only controller sees the swell, cuts the feedwater just when the drum needs more, and then has to recover a much larger drop.

**Three-element control.**
1. **Feedforward from steam flow:** feedwater follows steam, 1 t/h for 1 t/h, the mass balance. It acts on the real cause, not on the misleading level.
2. **Cascade on feedwater flow:** an inner flow loop makes the feedwater actually equal its setpoint, whatever the pump pressure does.
3. **The level controller** only trims the slow mismatch: blowdown, meter errors, the swell settling out.

For an integrating process the feedforward gain is the ratio of the ramp rates, not of static gains. Here that is the mass balance: 1 t/h of feedwater per t/h of steam, 0.83 % of the feedwater span.`,
    automation: String.raw`**Tags.** LT-501 (DP level, compensated for drum pressure), LIC-501 (master), FT-502 and FIC-502 (feedwater flow, slave), FT-503 (steam flow), FY-503 (the summing block), FV-502.

**Siemens.**
- Two PID_Compact instances, or **PID_Temp** in cascade, in the same OB30 (0.5 s), slave after master.
- The feedforward goes into the slave's setpoint: $q_{fw,sp} = q_s + \text{LIC-501 output}$, with the level controller's output centred on zero (a bias) or scaled as a trim of ±20 %.
- Start in **single-element** at low load (steam flow is unreliable below 20–30 %), then switch to three-element automatically above a load threshold, bumplessly.

**Measurement.**
- **Drum level DP transmitters must be density-compensated** for drum pressure. Uncompensated, the reading is wrong by tens of mm at part pressure.
- Use **two or three level transmitters** with a median select. The trip system has its own, independent transmitters.
- **Steam flow** should be pressure and temperature compensated, since it feeds forward one-for-one.

**Elsewhere.** Every boiler DCS library has a three-element drum-level template. The mass-balance feedforward plus a level trim is the same everywhere.`,
    commissioning: [
      'Verify the level transmitters against the gauge glass at operating pressure; check the density compensation over the pressure range.',
      'Calibrate FT-502 and FT-503 against each other at steady load: at steady state, feedwater ≈ steam + blowdown.',
      'Tune the feedwater flow loop first (fast, well damped), in automatic with a local setpoint.',
      'Tune the level master slowly with the flow loop closed: respect the shrink, about 45 s of effective dead time here.',
      'Add the steam-flow feedforward at gain 1 (mass balance); step the load and check the level only shows the swell, then returns.',
      'Test the switch between single and three-element, and what happens if FT-503 fails (fall back to single-element).',
    ],
    verdict: String.raw`**Three-element control.**
- A level-only PI either has to be slow (about 100–160 mm swings on load steps, nowhere near recovered in five minutes) or is fragile, and a 50 % swell increase takes it to the valve limits.
- Steam-flow feedforward cuts the load-step swings to about 20–35 mm.
- The feedwater flow loop removes pump-pressure upsets almost entirely.
- Together, the total IAE falls by three quarters.

This is the textbook case of the controller ladder done right: each element fixes one specific, physical problem.`,
  },
  jacket: {
    mechanical: String.raw`A 0.5 m³ jacketed reactor, **R-501**. The reaction gives off anything from nothing to 150 kW, so the jacket sometimes has to heat (steam, **TV-501B**) and sometimes cool (cooling water, **TV-501A**). One temperature controller drives both valves through a **split-range** output, **TY-501**: cooling water over the low part of the range, steam over the high part.

**Two energy balances.**

$$C_j\frac{dT_j}{dt} = Q_h - Q_c - UA\,(T_j - T),\qquad C_v\frac{dT}{dt} = UA\,(T_j - T) + Q_r - UA_l\,(T - T_{amb})$$

- Steam: $Q_h = Q_{h,max}\,f_h$, up to 250 kW.
- Cooling water: $Q_c = K_{cw}\,f_c\,(T_j - T_{cw})$, about 800 kW fully open with the jacket 40 K above the water.

**The two valves aren't equal.** Per % of controller output, the cooling side moves three times the heat the steam side does. Where the output crosses the split, the process gain jumps threefold. The cooling side also depends on the cooling water temperature, so it changes with the seasons.

**Where the split is made.**
- In the **positioners**: one valve calibrated to 4–12 mA (reverse), the other to 12–20 mA, both on one signal.
- Or in the **PLC**: one controller output, two analog outputs, each scaled to its own range.

The PLC version is easier to change. Either way, the split point and the gap are design choices, not facts of nature.`,
    control: String.raw`**One controller, two processes.** Linearized on either side of the split:

$$G_{cool}(s) \approx \frac{k'_{c}}{s}\,e^{-\theta s},\qquad G_{heat}(s) \approx \frac{k'_{h}}{s}\,e^{-\theta s},\qquad k'_{c} \approx 3.5\,k'_{h}$$

Heat losses are small, so it is nearly integrating, with about 22 s of effective dead time from the jacket and the thermowell.

**What a 3.5 : 1 gain step does to one PI.**
- **Tuned on steam,** it has 3.5 times the loop gain on cooling: there it is linearly unstable. It doesn't run away, because every swing back across the split drops the gain again. It hunts, bouncing the output between the two valves.
- **Tuned on cooling,** it's sluggish on steam, and setpoint changes overshoot.

**Two fixes, the same idea.**
1. **Move the split point** so each side gets a share of the range in proportion to its capacity: $s^* = Q_{c,max}/(Q_{c,max} + Q_{h,max}) \approx 76\ \%$. Then 1 % of output is about 10 kW either way.
2. **Characterize the output** in the PLC: the controller's 0–100 % is mapped onto the two valves so the gain is the same on both sides. Same result, done in software, and it can jump straight across a gap.

**The gap.** A band where both valves are shut stops them fighting (heating and cooling at once wastes energy). It is also a dead zone. Near the split, the controller has to integrate across it before anything happens, and the temperature wanders. Keep it small, or jump it.`,
    automation: String.raw`**Tags.** TT-501 (RTD in a thermowell), TIC-501, TY-501 (the split-range function), TV-501A (cooling water, fail open), TV-501B (steam, fail closed).

**Siemens.**
- PID_Compact in OB30 at 1 s, output 0–100 %.
- Two NORM_X/SCALE_X pairs, or the exported lines, turn it into two analog outputs.
- **Fail-safe directions decide the split's orientation.** Cooling water fail-open is the safe choice for an exothermic reactor, so it is on the low end: 0 % output means full cooling.
- **PID_Temp** has heating/cooling built in, with its own cooling factor. It is the same idea as the balanced split: one gain for heating and a scaled one for cooling.

**Elsewhere.** DCS split-range blocks (SPLITTER, SPLTR) take the split point, the gap and the overlap as parameters. Positioner split-range calibration (4–12 / 12–20 mA) works with any controller, but it is hidden in the field: document it on the loop sheet.

**Operator view.** Show both valve positions on the faceplate, not just the controller output. "Output 48 %" means nothing to an operator who doesn't know where the split is.`,
    commissioning: [
      'Decide the fail-safe positions first (cooling water fail-open for an exothermic reaction), and with them which valve takes the low end.',
      'Check each valve strokes over its own range: cooling fully open at 0 %, shut at the split; steam shut at the split, fully open at 100 %.',
      'Bump test on each side: step the output well inside the cooling range, then well inside the steam range, and compare the slopes.',
      'Set the split point from the ratio of the two gains (or characterize the output), then re-check that the bump tests now match.',
      'Tune one PI on the balanced split; test a step that crosses the split both ways.',
      'Run near the split for a while and watch for hunting between valves; if it does, look at the gap and the valves\' deadband before the tuning.',
    ],
    verdict: String.raw`**Balance the split, then tune one PI.**
- Split at 50 %, a PI tuned on steam hunts between the valves once the reaction needs cooling (linearly unstable there). One tuned on cooling overshoots setpoint changes by about 23 %.
- Move the split to about 76 % (or characterize the output) and one tuning gives 5–8 % overshoot on both sides, with the same margin everywhere.
- Keep the gap small: 6 % of gap made the temperature wander four times more near the split.

The fix is a valve setting, not a smarter controller.`,
  },
  blend: {
    mechanical: String.raw`In-line blending: a concentrate (stream B, 50 %) is dosed into a diluent (stream A) to make a product at 10 %. The diluent flow is **wild**: the upstream unit sets it, and **FT-801** only measures it. The concentrate goes through **FV-802** and **FT-802**. A static mixer blends them, and an analyzer, **AT-803**, reads the product through a 20 s sample line.

**Mixing balance** (well mixed, hold-up $V$):

$$V\frac{dc}{dt} = F_B\,c_B - (F_A + F_B)\,c$$

At steady state

$$c = \frac{F_B\,c_B}{F_A + F_B} = \frac{R\,c_B}{1 + R},\qquad R = \frac{F_B}{F_A}$$

**The ratio alone sets the product.** Whatever the throughput, a given ratio gives a given concentration. That is the physical fact ratio control is built on.

**What changes with throughput.**
- The gain from concentrate flow to concentration, $F_A(c_B - c)/(F_A + F_B)^2$, is three times larger at 20 m³/h than at 60.
- The mixing time, $V/(F_A + F_B)$, changes the same way: 96 s at 40 % rate, 22 s at 160 %.

**Sizes.** Diluent 40 m³/h (10–70), concentrate 10 m³/h through a valve good for 25, mixer hold-up 0.5 m³.`,
    control: String.raw`**Three ways to close the loop.**
1. **Feedback only** (analyzer → valve, possibly through a flow loop). Every production change upsets the product, and the analyzer sees it 20–25 s late.
2. **Feedforward from FT-801** (additive): $u = u_{PID} + K_{ff}\,(F_A - F_{A0})$. That is right for small changes around the design point.
3. **Ratio:** the concentrate flow setpoint is $R \times F_A$. It is multiplicative, so it is right at *any* rate.

**Why multiplicative matters.** Linearized at one rate, ratio and additive feedforward look the same: a feedforward gain $R_0$ from $F_A$. The difference is the trim.
- With additive feedforward, the analyzer controller adds a flow, and its loop gain is $\partial c/\partial F_B$. That varies 3 : 1 with throughput.
- With ratio, the analyzer controller sets $R$, and

$$\frac{\partial c}{\partial R} = \frac{c_B}{(1 + R)^2}$$

does not depend on the throughput at all. Ratio control linearizes the loop. Only the mixing time still changes with rate.

**What ratio doesn't do.** An unmeasured change in the concentrate's strength still has to be found by the analyzer. That is the trim's job, and the ratio's range (here 0–0.5) bounds how far the trim may go.`,
    automation: String.raw`**Tags.** FT-801 (diluent, wild), FFY-802 (ratio station), FIC-802 (concentrate flow), FV-802, AT-803 (analyzer, through a sample conditioning system), AIC-803 (the trim).

**Siemens.**
- FIC-802 is a PID_Compact in OB30 at 0.5 s.
- The ratio station is one line of SCL: SP := R × FT-801, limited to FIC-802's range.
- The trim (AIC-803) can run slower, since analyzer updates are often 10–60 s apart.
- Show the actual ratio (FT-802 / FT-801) on the HMI next to its setpoint: operators think in ratios.

**Practicalities.**
- **Low-flow cut-off:** below a minimum wild flow, hold the concentrate at minimum or stop it. A ratio of a noisy near-zero flow is noise.
- **Lead/lag:** if the two flows have different dynamics (one valve much slower), filter the wild flow so both arrive together.
- **Analyzer faults:** a frozen analyzer must freeze the trim (hold R), not let it drift. Use the analyzer's status bits.
- **Units:** mass or volume, the same on both meters. A ratio of a mass flow to a volume flow changes with density.

**Elsewhere.** DCS libraries have a RATIO block with bias, gain and ratio limits. Rockwell: one CPT instruction feeding the slave's setpoint.`,
    commissioning: [
      'Calibrate FT-801 and FT-802 to the same basis (both volume or both mass) and check them against each other on a known blend.',
      'Tune the concentrate flow loop first, on its own, fast and well damped.',
      'Put the ratio station in with the recipe ratio and the analyzer trim in manual; change the production rate and check the product barely moves.',
      'Then close the trim, slowly (its loop includes the sample line and the analyzer), and bound the ratio to a sensible range.',
      'Test a step in concentrate strength (a new tank) and a low-rate grade change.',
      'Decide what happens on an analyzer fault (hold the ratio) and below the minimum wild flow (concentrate to minimum).',
    ],
    verdict: String.raw`**Ratio control with an analyzer trim.**
- Production changes drop from 27 % of span (5 %-points) on the product to under 1 %.
- The trim handles the concentrate's strength.
- The trim's loop gain no longer depends on the rate. Additive feedforward handles the throughput nearly as well, but its trim overshoots 28–32 % at low rate where the ratio trim overshoots 10–13 %. On the mismatch test, ratio's IAE is a third of feedforward's.

A fixed ratio without a trim is fine only if the concentrate never varies.`,
  },
  crane: {
    mechanical: String.raw`An overhead crane's trolley runs along a 40 m bridge carrying a 10 t load on an 8 m rope. The trolley drive, **SC-601**, is a VFD in speed control: the PLC writes a speed reference (50 % = stop, 0 and 100 % = full speed either way) and the drive's own speed loop follows it within about 0.3 s, with a ramp limit of 0.4 m/s².

**The load is a pendulum hanging from the trolley.** Whenever the trolley accelerates by $a$, the load is left behind and starts to swing:

$$\ddot\theta = -\frac{g}{L}\sin\theta - \frac{a}{L}\cos\theta - 2\zeta_s\omega_0\dot\theta + \frac{F_w\cos\theta}{mL}$$

- Natural frequency $\omega_0 = \sqrt{g/L}$: 1.1 rad/s, a period of 5.7 s at 8 m. The load's mass doesn't come into it.
- Almost no damping ($\zeta_s \approx 0.005$): a swing takes minutes to die out on its own.
- Wind $F_w$ on the load holds it at an angle $\tan\theta = F_w/(mg)$: 4 kN on 10 t is 2.3°.

**What is measured.**
- **ZT-602**, a camera on the trolley looking down at the load: the sway angle.
- **ZT-601**, the load's position: the trolley encoder plus $L\sin\theta$ (the hoist encoder gives $L$).

**The goal** is to put the load where it should go, quickly, and have it hanging still when it gets there. The trolley's own position matters only as the means.`,
    control: String.raw`**The model** (linearized, small angles): the drive's lag, the trolley as an integrator of speed, and the pendulum.

$$\frac{x_L(s)}{v_{ref}(s)} = \frac{1}{s(\tau_d s + 1)}\cdot\frac{\omega_0^2 + 2\zeta_s\omega_0 s}{s^2 + 2\zeta_s\omega_0 s + \omega_0^2}$$

**Why PID struggles.** The pendulum puts a resonance at $\omega_0$ with a peak of about $1/(2\zeta_s) = 100$ (40 dB) in the loop, and 180° of phase lag after it. A PID on the load position has to keep its loop gain at $\omega_0$ far below 1, which pushes its crossover far below $\omega_0$. The result is a loop that is slow (a minute to move 20 m) and still leaves the load swinging, because nothing in it damps the swing.

**What state feedback does.** It feeds back every state: trolley position and speed, sway angle and sway rate. Feeding back the sway rate is what damps the pendulum: the trolley moves under the load to take the swing out, which is what a good crane driver does by hand. Pole placement makes it explicit: the swing's poles at $-0.006 \pm 1.1j$ move to $\zeta = 0.8$, while the rest of the loop is put where it is wanted.

**The observer.** Only two things are measured, and the speeds aren't. A Kalman filter estimates them, together with the wind force, from the two readings and the speed reference it sent.`,
    automation: String.raw`**Tags.** ZT-601 (load position, 0–40 m), ZT-602 (sway angle, ±10°), SC-601 (trolley drive speed reference), ZIC-601.

**Siemens.**
- The drive does the speed loop. The PLC closes the position and sway loops at 50 ms in a cyclic interrupt (OB30), a fixed cycle because the controller's matrices are discretized for it.
- No standard block does state feedback: the exported **LL_StateFb** is the whole controller (observer, gains, offset handling) in SCL, with its matrices as LReal arrays.
- Crane builders sell this as a technology package (anti-sway and positioning in the drive or in a motion controller), with the rope length from the hoist and a sway camera. Under the hood it is this structure.

**Rope length.** The controller is designed for 8 m. A load hoisted to 3 m or lowered to 13 m changes the swing frequency by up to 60 %. Real systems schedule the design on the hoist encoder; here the mismatch test shows how far one design stretches.

**Safety.** The anti-sway is a convenience function, not a safety function: travel limits, overspeed and the brakes stay in the drive and the safety PLC.`,
    commissioning: [
      'Check the drive: speed loop tuned, ramp set, reference direction (positive speed = positive position).',
      'Calibrate the encoders (trolley position, hoist rope length) and the sway camera zero with the load hanging still.',
      'Measure the swing: run the trolley a few metres in manual, stop, and time ten swings. Compare with 2π√(L/g).',
      'Load the model with the measured rope length and drive time constant; check the observer\'s estimate against the camera with the controller still in manual.',
      'Close the loop on short moves first, then full-length moves; check the residual sway at the end of each.',
      'Test at the shortest and longest rope lengths in use, or schedule the design on the hoist position.',
    ],
    verdict: String.raw`**State feedback with a sway measurement and an observer that knows about the wind.** It carries the load 20 m in 23 s and puts it down hanging still (0.09° of swing left), rejects a 4 kN gust within 8 s, and still works with the load 5 m lower than designed for.

The best PI on the load position takes over a minute for the same move and leaves 2° of swing. This is one of the places on the ladder where PID simply can't do the job, because it has nothing with which to damp the swing.`,
  },
  servo: {
    mechanical: String.raw`A motor drives a heavy roll through a long shaft and couplings. The drive, **SY-701**, makes torque (its current loop settles in about 2 ms): the PLC writes a torque reference, 50 % = none, 0 and 100 % = full torque either way (±200 N·m). Encoders measure the motor speed (**ST-702**) and the roll speed (**ST-701**).

**Two masses and a spring.**

$$J_m\dot\omega_m = T - k\varphi - d(\omega_m - \omega_L) - b_m\omega_m$$
$$J_L\dot\omega_L = k\varphi + d(\omega_m - \omega_L) - b_L\omega_L - T_L,\qquad \dot\varphi = \omega_m - \omega_L$$

- **Resonance** $\omega_r = \sqrt{k(1/J_m + 1/J_L)}$: 73 rad/s (11.6 Hz). The shaft winds up and springs back with the two inertias swinging against each other.
- **Anti-resonance** $\omega_a = \sqrt{k/J_L}$: 37 rad/s. Seen from the motor, the roll swings while the motor nearly stands still.
- **Damping** is whatever the steel and the couplings give: $\zeta \approx 0.005$.

**Load torque** $T_L$ is what the process takes from the roll: web tension, material entering a nip.

**What you'd change in the hardware.** A stiffer shaft (bigger diameter, shorter, a stiffer coupling) raises the resonance and lets any controller go faster. A lighter roll or a heavier motor moves the inertia ratio. Both are often cheaper than a cleverer controller, on a new machine.`,
    control: String.raw`**Two transfer functions,** torque to motor speed and torque to roll speed:

$$\frac{\omega_m}{T} = \frac{J_L s^2 + \ldots + k}{s\,(J_mJ_L s^2 + \ldots + k(J_m + J_L))},\qquad \frac{\omega_L}{T} = \frac{k}{s\,(J_mJ_L s^2 + \ldots + k(J_m + J_L))}$$

- **On the motor** (collocated): an anti-resonance zero pair below the resonance pole pair. The phase never drops below −180°, so a fast loop is possible, but it barely sees the roll ringing at $\omega_a$.
- **On the roll** (non-collocated): the resonance with nothing in front of it, so the phase falls by another 180° at 73 rad/s. A PI on the roll speed has to stay well below the resonance: here about 1.5 rad/s.

**The usual fixes.**
- **Cascade:** a fast speed loop on the motor encoder (the drive's own), the roll loop outside it.
- **A notch filter** on the torque reference at the resonance, so the loop doesn't excite it. It works if the resonance doesn't move, and a fuller roll moves it.
- **State feedback:** feed back the shaft twist and both speeds, estimated by an observer from the encoders. That is **active damping**: the controller adds the damping the shaft hasn't got.`,
    automation: String.raw`**Tags.** ST-701 (roll speed), ST-702 (motor speed), SY-701 (drive torque reference), SIC-701.

**Where the loops run.**
- Torque and speed loops normally run **in the drive** (current loop at 62.5–125 µs, speed loop at 125 µs–1 ms). Drives have notch filters on the speed controller's output and, in the better ones, observers for exactly this load.
- The 2 ms cycle here is a fast motion controller or a PLC in isochronous mode (PROFINET IRT, OB61 synchronized to the bus). A standard OB30 at 10 ms couldn't do it: the resonance would be beyond half the sampling frequency.
- No PID_Compact. The exported **LL_StateFb** runs the controller in SCL; at 2 ms the matrix products (about 2n² multiply-adds) are a few microseconds on an S7-1500.

**Encoders.** Speed from an encoder is a difference of positions: quantization is noise, and the faster the loop, the more of it reaches the torque. Resolution and a sensible speed filter matter as much as the tuning.`,
    commissioning: [
      'Run the drive\'s own identification (motor data, current loop). Check torque direction against speed direction on both encoders.',
      'Measure the resonance: a frequency sweep or a torque step with the speed loop slow, looking at both encoders. Note the resonance and anti-resonance frequencies.',
      'Commission the motor speed loop first, with a notch at the resonance if it rings. This is the fallback.',
      'For state feedback: fit the two inertias and the stiffness to the measured frequencies, then check the observer\'s estimate of the roll speed against its encoder in open loop.',
      'Close the loop slowly (low ω_n), raise it while watching the twist and the torque ripple.',
      'Test with an empty and a full roll: the resonance moves with the inertia.',
    ],
    verdict: String.raw`**It depends how fast the roll has to be.**
- A PI on the roll speed alone is stuck far below the resonance: a speed change takes over a second and a load step costs 10 % of span.
- A **cascade on the motor speed**, what every drive does, settles in about a second with load dips under 1 %. With a notch filter, that is the standard answer and usually enough.
- **State feedback with an observer** (active damping) settles in about 0.35 s, three times faster, with the same load rejection and more margin (Ms 1.5 against 2.7), and stays well damped with a roll twice as heavy. It needs a good model of the drive train: worth it on a machine whose speed changes are the product, such as a printing or converting line.`,
  },
  maglev: {
    mechanical: String.raw`A 2 kg steel armature hangs under an electromagnet, with nothing touching it: one axis of a magnetic bearing, the kind that carries turbomachinery rotors without friction or oil. A current amplifier, **ZY-801**, drives the coil (0–6 A); an inductive gap sensor, **ZT-801**, reads the air gap (0–30 mm).

**The magnet pulls harder the closer the armature gets:**

$$F = F_1\,i^2\left(\frac{10\ \text{mm}}{x}\right)^2,\qquad m\ddot x = mg - F$$

with $x$ the gap. At 15 mm, holding 2 kg takes about 3 A.

**Why it can't be left alone.** Let the armature drop a little: the gap grows, the pull weakens, and it drops further. Let it rise: the pull grows and it jumps to the magnet. Linearized, the gap has a pole at

$$p = +\sqrt{2g/x_0}$$

36 rad/s at 15 mm. Any disturbance grows by $e^{36t}$: doubled in 20 ms.

**Limits.** End stops at 2 mm (the pole face cover) and 28 mm (the landing pad). The amplifier is quick (about 3 ms) but can't give more than 6 A: a controller that asks for too much at the wrong moment drops the armature.`,
    control: String.raw`**Linearized at a gap** $x_0$, from current to gap:

$$\frac{\delta x(s)}{\delta i(s)} = \frac{-2g/i_0}{s^2 - 2g/x_0}$$

an unstable pole at $+\sqrt{2g/x_0}$ and its mirror image. More current closes the gap, so the action is inverted.

**What an unstable plant asks of the loop.**
- **A minimum speed.** The loop has to cross over above the unstable pole, or the armature gets away faster than the controller reacts. Here that means well above 36 rad/s, against an amplifier at 333 rad/s and a 1 ms cycle: the window between "fast enough" and "too fast for the hardware" is narrow.
- **Derivative action, or something like it.** A P controller only makes a spring, and with no damping it oscillates. The D term (or the speed estimate of an observer) adds the damping.
- **A lower bound on sensitivity.** For an unstable pole $p$, the peak sensitivity can't be pushed as low as on a stable plant; $M_s$ around 2–3 is typical, not careless tuning.
- **The gain moves with the setpoint.** At 8 mm the pole is at 50 rad/s; at 22 mm at 30 rad/s, and the gain per amp changes too. One tuning has to cover both.

**Tuning rules don't apply.** SIMC, Lambda and the rest all start from a stable or integrating model. Here the design is by hand from the model (pole placement, or loop shaping on the Bode plot).`,
    automation: String.raw`**Tags.** ZT-801 (gap, 0–30 mm), ZY-801 (current amplifier, 0–6 A), ZIC-801.

**Speed.** A 1 ms cycle with a 3 ms amplifier. On an S7-1500 that means an isochronous OB at 1 ms or faster, with the gap sensor and the amplifier on fast I/O. Real magnetic bearings run at 10–20 kHz on dedicated controllers, with the PLC setting the position and watching the alarms.

**PID.** PID_Compact can't do it: its fastest sensible cycle and its built-in filters are too slow. A PID in SCL in the fast OB works (D on the measurement, setpoint weight below 1, a slow integral).

**State feedback.** The exported **LL_StateFb**: its observer estimates the speed from the gap (no differentiating of a noisy reading) and the extra load from the current it takes.

**Start-up.** The armature starts on the landing pad. Lift-off is a ramp of the setpoint from 28 mm, with the integral clamped until the armature is free, or it winds up while the armature can't move.`,
    commissioning: [
      'Calibrate the gap sensor against feeler gauges at three gaps; check its direction.',
      'Check the amplifier: current at 0, 50 and 100 % output, and its response to a step (it sets how fast the loop can be).',
      'Measure the magnet constant: the current that holds the armature at two gaps (by hand, with a jack under it).',
      'First lift-off with PD only and the setpoint ramped from the pad; then add a slow integral.',
      'Test at the closest and furthest gaps in use: the plant is faster and more unstable close in.',
      'Set the trips: gap out of range or amplifier saturated for more than a few ms means land it, now.',
    ],
    verdict: String.raw`**PID works, once the setpoint weight is right.** PD plus a slow integral (Kc 4, Td 20 ms, Ti 150 ms) with b = 0.3 moves the gap in about 0.2 s without overshoot and holds half a kilogram of extra load to a 2 % dip. With b = 1 the same PID overshoots 130 % on a 3 mm step, and on the mismatch test drops the armature on the pad.

**State feedback** with an observer settles about twice as fast (0.06–0.13 s) and has more margin (Ms 2.4 against 3.1), but overshoots more on gap changes (up to 9 %, and 26 % on the mismatch test). It is not a clear win. What this plant teaches is not "use state feedback" but what instability demands: a minimum speed, derivative action, fast hardware, and a gain that changes across the range.`,
  },
  mixing: {
    mechanical: String.raw`A tank blends hot water (70 °C, through **FV-901**) and cold mains water (15 °C, through **FV-902**) and supplies the mix by gravity to users downstream: a hot-water set for washing or CIP, a dilution tank, a feed tank. Both the **temperature** (TT-901) and the **level** (LT-902) have to be held.

**Two balances, two valves:**

$$A\frac{dh}{dt} = F_h + F_c - K_{out}\sqrt{h},\qquad A\,h\,\frac{dT}{dt} = F_h(T_h - T) + F_c(T_c - T)$$

- **Level** follows the *total* inflow: either valve raises it.
- **Temperature** follows the *mix*: the hot valve raises it, the cold valve lowers it.

So every valve moves both variables. Open the hot valve to warm the tank and the level rises too; open the cold valve to raise the level and the temperature drops.

**The operating point decides how bad that is.** At 35 °C, 36 % of the inflow is hot. A hot-water change mostly moves the temperature, a cold-water change mostly moves the level. At 55 °C it is the other way round.

**What you'd change in the hardware.** Flow meters on both inlets turn the problem into total flow and mix ratio, which barely interact (see the verdict). A thermostatic mixing valve does the same mechanically.`,
    control: String.raw`**The gain matrix.** At steady state, % of span per % of valve, at 35 °C:

$$\begin{bmatrix}\Delta T\\ \Delta h\end{bmatrix} = \begin{bmatrix}0.35 & -0.30\\ 1.0 & 1.5\end{bmatrix}\begin{bmatrix}\Delta u_{hot}\\ \Delta u_{cold}\end{bmatrix}$$

**The relative gain array** compares each gain with the same gain once the other loop is closed:

$$\lambda_{11} = \frac{1}{1 - \dfrac{g_{12}g_{21}}{g_{11}g_{22}}} = \frac{T_h - T}{T_h - T_c}$$

- **λ₁₁ = 1:** the other loop changes nothing. Pair hot → temperature and tune each loop alone.
- **0.5 < λ₁₁ < 1:** closing the level loop *reduces* what the temperature loop sees by λ. They interact, and each loop tuned alone will be off.
- **λ₁₁ < 0.5:** the other pairing has the larger relative gain: cross it.
- **λ₁₁ < 0** (not here): closing the other loop reverses the sign. That pairing must never be used.

Here λ₁₁ is 0.82 at 25 °C, 0.64 at 35 °C, 0.36 at 50 °C and 0.27 at 55 °C: **the right pairing flips with the recipe**.

**Decoupling.** A static decoupler (or the change of variables to total flow and ratio) cancels the steady interaction, so each loop sees only its own variable. **MPC** needs no pairing at all: it uses the whole matrix, dynamics included, and the valve limits.`,
    automation: String.raw`**Tags.** TT-901 (0–100 °C), LT-902 (0–2 m), FV-901 (hot), FV-902 (cold), TIC-901, LIC-902.

**Siemens.**
- **Two loops:** two PID_Compact instances in one OB30, 2 s cycle. The decoupler is two lines of SCL between their outputs and the valves (the exported call). In manual, undo the decoupler for bumpless transfer: the exported code shows how.
- **Ratio form** (often the best): LIC sets the total flow, TIC the hot fraction; then $F_{h,sp} = x F$, $F_{c,sp} = (1 - x)F$ to two flow loops on FT meters. That decouples exactly, at any temperature.
- **MPC:** the exported LL_Mpc in SCL (a small one fits a PLC at a 2 s cycle), or, for a bigger plant, an MPC on a PC or edge device writing setpoints to the PID loops.

**Interlocks.** Low level stops the outlet pump (if there is one); high temperature (scalding) closes the hot valve whatever the controller says. These sit outside the control logic.`,
    commissioning: [
      'Calibrate TT-901 and LT-902; check both valves stroke and fail safe (hot: closed).',
      'Bump test each valve on its own, the other in manual: four gains (each valve → each variable) and their dynamics.',
      'Work out the relative gain at the recipes you run; choose the pairing (or cross it per recipe).',
      'Commission one loop at a time with the other in manual, then close both and check how they fight.',
      'If they do, add the static decoupler from the bump-test gains, or move to the total-flow / ratio structure.',
      'For MPC: step tests on both valves at two operating points, a model per region, and an operator display that shows what it is trying to do.',
    ],
    verdict: String.raw`**Decouple it: a static decoupler from the bump-test gains, or better, control total flow and hot fraction.** Two loops tuned one at a time fight: a level change pulls the temperature by 6 °C, a demand change by 4 °C. With the decoupler, 0.1 °C and 0.03 °C.

**MPC** does about as well on interaction and better on the hot-supply upset (0.7 °C instead of 1.6 °C). Where it earns its place is at the limits: when the hot valve runs out, its weights decide what gives, and it recovers without the overshoot that two plain loops show. On one tank that is rarely worth the model upkeep. On a unit with five interacting variables and a few limits that often bind, it is.

**Watch the operating point.** λ₁₁ runs from 0.82 to 0.27 across the recipes: the pairing and the decoupler that suit 35 °C don't suit 55 °C.`,
  },
  batch: {
    mechanical: String.raw`A 2 m³ glass-lined reactor runs an exothermic batch reaction, A → B, about 2 h from charge to discharge. A **temperature control unit** (TCU) heats or cools the jacket fluid. The PLC writes the jacket temperature setpoint (**TY-1001**, 10–130 °C), and the TCU's own loop makes it, with a lag of about 3 minutes (the TCU, the jacket's volume and the thick wall). **TT-1001** reads the batch.

**The heat balance:**

$$C\frac{dT}{dt} = \underbrace{(-\Delta H)\,k(T)\,c\,V}_{Q_r} - UA\,(T - T_j) - UA_l(T - 20),\qquad k(T) = k_{80}\,e^{\frac{E}{R}\left(\frac{1}{353} - \frac{1}{T + 273}\right)}$$

- The reaction rate doubles about every 7 K, so the reaction heat does too: **positive feedback** from temperature to heat.
- At 80 °C with a full charge, the reaction makes 500 kW, and its heat output grows by 48 kW for every 1 K hotter. The jacket removes 60 kW per K of difference.
- As A is used up, $Q_r$ and its slope fall: by the end of the batch the reaction hardly matters.

**The cooling margin** is what decides: $UA + UA_l - dQ_r/dT$. At the start of a batch it is about 12 kW/K; with 20 % more reaction heat and a 20 % fouled jacket together it goes negative, and the reactor would run away on its own. The **mechanical view's Semenov diagram** shows that crossing.

**What you'd change in the plant.** Dose the reactant over time (semi-batch) instead of charging it all, so there is never much to react. Heat up more slowly, so it reacts on the way. Keep the jacket clean. These protect the batch more than any controller can.`,
    control: String.raw`**Linearized at one stage of the batch** (the reactant frozen at what is left), from TCU setpoint to batch temperature:

$$G(s) \approx \frac{K}{(\tau s + 1)(\tau_j s + 1)},\qquad K \propto \frac{UA}{UA + UA_l - dQ_r/dT},\qquad \tau = \frac{C}{UA + UA_l - dQ_r/dT}$$

At 80 °C:

| | Reactant left | K (%/%) | τ |
|---|---|---|---|
| Start of the batch | 2 kmol/m³ | 3.9 | 12 min |
| Halfway | 1 kmol/m³ | 1.3 | 5 min |
| End | 0.2 kmol/m³ | 0.86 | 4 min |

**The catch for PID.** Commission it on a quiet batch (or a water run) and the loop is 4.5 times livelier than it needs to be when a full charge is in. Tune it for the start of a batch and it is slow for the rest. Either way it sees two different plants.

**The options.**
- **Gain scheduling** on the batch stage (time, or conversion from a heat balance).
- **Adaptive control:** let the controller measure the plant as it goes and retune.
- **ADRC:** treat the reaction heat as a disturbance to estimate and cancel.

And, honestly: a slower heat-up, or dosing, which shrinks the problem itself.`,
    automation: String.raw`**Tags.** TT-1001 (0–150 °C), TIC-1001, TY-1001 (TCU setpoint, 10–130 °C).

**Structure.** This is already a cascade: the TCU's jacket loop is the slave, TIC-1001 the master. Keep it that way. The TCU makes the jacket behave, whatever heats or cools it.

**Siemens.**
- **PID_Temp** in its cascade mode is the natural block for reactor temperature: heating/cooling outputs, a master/slave pair, its own tuning. PID_Compact on the batch temperature writing the TCU setpoint works too.
- **Self-tuning:** PID_Compact's and PID_Temp's tuning (pretuning, fine tuning) runs once, on demand. Continuous adaptation needs your own code (the exported LL_SelfTune), with a freeze switch for the operator.
- **ADRC:** your own SCL (LL_Adrc).
- **Recipe:** run the heat-up as a setpoint **ramp** (the batch scenario's 2 °C/min) from the phase logic (ISA-88), not as a step.

**Safety.** A high-temperature trip on an independent sensor, emergency cooling (full cooling water, quench or dump) and, for real runaway potential, a separate safety system. None of that belongs to the control loop.`,
    commissioning: [
      'Check the TCU on its own: jacket setpoint steps, heating and cooling, its limits and how fast it gets there.',
      'Run a water batch (no reaction) to measure UA and the heat capacity: the reactor\'s quiet behaviour.',
      'From the reaction\'s calorimetry (heat of reaction, rate vs temperature), work out the cooling margin at the hold temperature with a full charge. If it is small, change the recipe first.',
      'Tune for the hardest stage: the start of the hold with a full charge, not the water batch.',
      'Run the first real batches with the heat-up ramp slowed down and the operator watching the jacket temperature: how much cooling is it using?',
      'Set and test the high-temperature trip and emergency cooling independently of the control loop.',
    ],
    verdict: String.raw`**Tune for the start of the batch, and make the recipe safe; then a PI is enough.**
- A PI commissioned on a quiet batch (Kc 0.88) has Ms 2.6 when a full charge is in, and a strong batch overshoots by 2.4 °C.
- Tuned for the start of the batch (SIMC, Kc 0.47) it is robust there (Ms 1.3) but lags the 2 °C/min heat-up by 26 °C. Slow the ramp or add the ramp's feedforward.
- The **self-tuning PI**, starting from the quiet-batch tuning, learns its way to Ms 1.4 at the start of the batch and no overshoot. But its estimate wanders when nothing moves: late in a quiet hold it detuned itself to Kc 0.25.
- **ADRC** holds the start of the batch with Ms 1.6 and no model beyond b₀, but lags ramps.

**No controller holds a reactor whose cooling margin has gone.** Across a ±20 % spread of reaction heat and jacket fouling, every one of them meets reactors that run away. That is fixed in the recipe (dosing, slower heat-up, a cleaner jacket) and guarded by the safety system, not in the loop.`,
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
  },  smith: {
    summary: 'A PID that sees a prediction of its measurement. A model of the process runs beside the plant, with and without its dead time, and the difference is added to the measurement, so the PID can be tuned as if the dead time weren\'t there.',
    theory: String.raw`O. J. M. Smith, 1957. Split the process into a fast part and a delay, $G(s) = G_0(s)\,e^{-\theta s}$, and keep a model of both, $G_m(s) = G_{m0}(s)\,e^{-\theta_m s}$. The controller $C$ is fed

$$y_{fb} = y + G_{m0}\,u - G_{m0}\,e^{-\theta_m s}\,u$$

If the model is exact, the last term cancels the real measurement's response to $u$. What is left is $G_{m0}u$: the process *without* its delay. The closed loop becomes

$$\frac{y}{r} = \frac{C\,G_0}{1 + C\,G_0}\,e^{-\theta s}$$

The delay has moved out of the loop. $C$ is tuned for $G_0$ alone, and the answer arrives $\theta$ later.

**As a single controller.** The predictor and $C$ together are

$$C_{eff} = \frac{C}{1 + C\,G_{m0}\,(1 - e^{-\theta_m s})}$$

That's what the Bode plot here uses. Its gain ripples with frequency, every $2\pi/\theta_m$ rad/s, which is why the delay margin, not the phase margin, is the number to watch.

**What it doesn't change.** Load disturbances still pass through the plant's full delay before the controller sees them. Only the response *after* that gets faster. Setpoint tracking gains the most.`,
    works: [
      'Dead time much longer than the process lag (θ/τ above about 1): belts, long sample lines, paper machines, extruders, analysers.',
      'The dead time is known and steady, or can be calculated (belt length / belt speed).',
      'Frequent setpoint changes, where "the fast response, θ later" is a real gain.',
    ],
    breaks: [
      'The dead time changes and the model doesn\'t: 20 % error with a fast inner PI can be worse than a plain PI.',
      'Integrating processes: a plain Smith predictor can\'t reject a constant load on one (it leaves an offset or drifts). They need a modified structure.',
      'Load upsets: they still take the full dead time to be seen, so the predictor helps little there.',
      'Maintenance: three model parameters someone must keep right, inside a structure most technicians haven\'t met.',
    ],
    tuning: String.raw`1. **Identify** gain, lag and dead time from a bump test (FOPDT is usually enough).
2. **Put them in the model.** $\theta_m$ is the whole dead time the loop sees, half a controller cycle included.
3. **Tune the PI for the lag alone**, as if $\theta = 0$. SIMC gives $T_i = \tau$, $K_c = \tau/(K\tau_c)$.
4. **Choose $\tau_c$ for robustness, not speed.** The undelayed process would allow $\tau_c$ of a few seconds, but any error in $\theta_m$ acts like unmodelled dead time. Here $\tau_c = \max(\tau, \theta/2)$ keeps Ms near 2 with the dead time ±15 % off. Faster and the loop rings as soon as the belt slows down.
5. **Test with the model wrong on purpose:** dead time ±20 %, gain ±20 %.`,
    implementation: String.raw`- **Order in the cycle:** update the model with *last* cycle's controller output, compute the corrected measurement, then run the PID.
- **The dead time is a ring buffer** of $n = \theta_m/T_s$ model outputs. The cycle time must be constant, so use a cyclic interrupt.
- **Manual mode:** re-zero the model (output = the present value, buffer cleared), so switching to automatic is bumpless.
- **Show the real measurement** to the operator, not the corrected one.
- **Variable dead time:** recompute $n$ from the speed that causes it (belt speed, line flow).`,
    siemens: String.raw`- **No standard block** for dead-time compensation in PID_Compact or PID_Temp.
- The exported **LL_Smith** FB (SCL, ring buffer of up to 1000 cycles) goes in front of PID_Compact: its Corrected output feeds PID_Compact's Input.
- For longer dead times, sample the model slower than the PID (a buffer entry every few cycles), or use a larger array.
- Keep the PID's own pretuning switched off: it would tune for the delayed process.`,
    broad: String.raw`- **DCS libraries** often have a dead-time block (DEADTIME, DELAY) that makes building a Smith predictor a few blocks of configuration.
- **IMC** (internal model control) is the general form of the same idea: a model in parallel with the plant, and the controller acting on the model error. A Smith predictor is IMC with a PI in place of the model inverse.
- **MPC** handles dead time natively, in its prediction, along with constraints.`,
  },

  override: {
    summary: 'Two (or more) controllers share one valve through a high or low selector: the normal one, and one that holds a limit. Whichever asks for the safer output wins. The controller not in charge must track the valve, or it winds up and takes over late.',
    theory: String.raw`Most of the time a loop has one job, but it also has limits it must never cross: a maximum steam flow, a high tank level, a motor current. **Override (selector) control** gives each limit its own controller, all acting on the same valve:

$$u = \max(u_{normal},\ u_{limit})\quad\text{or}\quad u = \min(u_{normal},\ u_{limit})$$

The selector picks whichever is safer, so the limit controller takes the valve exactly when its variable reaches its limit, and hands it back when it doesn't need it.

**Choosing max or min.** Ask what the limit controller wants when its variable is past the limit.
- A steam flow limiter wants *less* opening: low select.
- A high-level override on an outlet valve wants *more*: high select.

**Windup: the real design problem.** The controller not in charge still sees an error and keeps integrating. Its output runs to a limit (0 or 100 %) and stays there. When it should take over, it first has to integrate all the way back. Meanwhile the other controller holds the valve in the wrong place.

**External reset feedback** fixes it. Every controller's integral follows the *selected* output through its own $T_i$ lag:

$$I(s) = \frac{u_{sel}(s)}{T_i\,s + 1}$$

For the controller in charge this is exactly normal PI action. For the others, the output becomes "valve signal + my own P and D", so each one sits just its proportional action away from the valve, and takes over smoothly the moment its error says it should.

**Linear analysis** sees one loop at a time: the normal controller, and the override when it is in charge. The selector switches between them.`,
    works: [
      'Constraints that matter only sometimes: steam or fuel allowances, high/low levels, compressor surge and motor current, maximum tube-skin temperatures.',
      'Start-up and shutdown, where a different variable should be in charge for a while.',
      'Any "control this, unless that" requirement that would otherwise be a pile of IF statements.',
    ],
    breaks: [
      'No tracking: the idle controller winds up, takes over late, and hands back late (bumps both ways).',
      'Selector direction wrong: the limit controller wins all the time, or never.',
      'Limit controllers tuned like normal ones: once in charge they must act fast, or the limit is overshot.',
      'Two overrides fighting near both limits at once: then the process genuinely can\'t meet both, and someone must decide which wins.',
    ],
    tuning: String.raw`1. **Tune each controller on its own**, as if it were the only one: the normal one for its job, the limit one for its variable.
2. **Make the limit controller tight.** Once it has the valve, its job is to stop at the limit, not to be gentle.
3. **Set the limit with margin** below the real constraint. The override acts only when the limit is reached, so expect some overshoot.
4. **Test a takeover and a hand-back** with tracking on, and once with it off to see what tracking is saving you.`,
    implementation: String.raw`- Run every controller every cycle, then select: $u = \max(\ldots)$ or $\min(\ldots)$.
- **External reset:** each controller's integral follows the selected output. Without an ER input, the classic workaround is to put the controllers not selected into tracking (manual with ManualValue = the selected output). It works, but they then lose their proportional "opinion".
- **Show which controller has the valve** on the faceplate, and log the switches: an override that is in charge a lot is telling you about the plant.
- **Manual mode:** all controllers track the manual output.`,
    siemens: String.raw`- **PID_Compact** has no external-reset input. The usual pattern is two instances plus a MAX/MIN in SCL; the one not selected goes into manual (ManualEnable, ManualValue = the selected output) each cycle.
- The exported **LL_PID** has ExtResetEnable / ExtReset, which do the real thing: its integral follows the selected output through Ti.
- **PID_Temp** is the same in this respect.
- Put the selector logic in the same OB30 as the controllers, after both calls.`,
    broad: String.raw`- **DCS:** high/low selector blocks (HSEL, LSEL, SIGSEL) with built-in back-calculation (BKCAL) to every input, so external reset is automatic.
- **Rockwell:** PIDE has a "track" input and the SEL / ESEL instructions.
- **Model predictive control** handles constraints in one optimization instead of a selector, at the cost of a model and a lot more engineering.`,
  },
  ratio: {
    summary: 'The controlled flow follows a wild flow that something else sets, at a set ratio: SP = R × wild flow. An analyzer or quality controller may trim the ratio. The product stays right through every production change, and the trim\'s loop gain stops depending on the rate.',
    theory: String.raw`Many processes care about a **proportion**: fuel to air, reagent to feed, concentrate to diluent. If the proportion is right, the product is right, whatever the throughput. Ratio control holds the proportion directly:

$$F_{B,sp} = R \times F_A$$

- $F_A$ is the **wild** flow, measured but set elsewhere (production rate).
- $F_B$ is the controlled flow, with its own flow loop.

**Fixed ratio** is pure feedforward: no quality measurement at all. It is right only as long as the recipe ratio is right.

**Trimmed ratio** adds a slow outer controller on the product quality that adjusts $R$. That is cascade, with a multiplication in the middle. Linearized at one throughput,

$$\delta F_{B,sp} = R_0\,\delta F_A + F_{A0}\,\delta R$$

that is, feedforward gain $R_0$ from the wild flow, plus the trim's output scaled by $F_{A0}$.

**Why not just additive feedforward?** The quality usually depends on the ratio, not on the flow. With ratio control the trim's loop gain, $\partial c/\partial R$, doesn't depend on the throughput. With additive feedforward it does (here 3 : 1 between low and high rate), so one tuning is too fast at low rate and too slow at high rate.`,
    works: [
      'Blending, dosing and dilution: chemicals into water, additives into fuel, concentrate into product.',
      'Combustion: air follows fuel (often with cross-limiting so air leads on increases and lags on decreases).',
      'Any process where the quality depends on a proportion and the throughput is set elsewhere.',
    ],
    breaks: [
      'The two meters disagree (different bases, drift): the ratio is wrong without anyone seeing it.',
      'Very low wild flow: the ratio of a noisy, near-zero signal is noise. Cut off below a minimum.',
      'Different dynamics on the two streams: one arrives before the other, and the product shows a transient on every rate change (add a lead-lag on the wild flow).',
      'Unmeasured changes in either stream\'s composition: only a trim on a quality measurement catches them.',
    ],
    tuning: String.raw`1. **The flow loop first,** fast and well damped, on its own setpoint.
2. **The ratio from the recipe:** the mass balance, $R = F_B/F_A$ at the design point.
3. **The trim on the quality measurement,** with the flow loop and the ratio closed. Its process is "ratio → quality": tune it on a step in $R$. It includes the analyzer delay, so it is slow.
4. **Limit the ratio range** the trim may use, so a failed analyzer can't drive it anywhere absurd.`,
    implementation: String.raw`- **Ratio station:** SP₂ = R × wild flow, limited to the flow loop's range. Below a minimum wild flow, hold a minimum.
- **Bumpless:** in manual, the trim tracks the ratio actually being run, $F_B/F_A$.
- **Windup:** while the flow loop is saturated, hold the trim's integral, as in cascade.
- **HMI:** show the ratio setpoint and the actual ratio side by side.`,
    siemens: String.raw`- No ratio block in PID_Compact: one line of SCL computes the setpoint, as in the exported call, before the flow controller.
- Use **PID_Compact** for the flow loop. Use a second one for the trim, its output scaled 0–100 % → [R_min, R_max].
- **Cross-limiting** for combustion (air leads fuel up, lags it down) is a MAX/MIN on the two setpoints: the same selector idea as override control.`,
    broad: String.raw`- **DCS:** RATIO blocks with ratio limits and bias, and a cascade connection to the slave.
- **Combustion control** standards (NFPA 85, EN 12952) build on ratio with cross-limiting and an O₂ trim: the same structure as here.`,
  },
  statefb: {
    summary: 'Every state of the plant fed back with its own gain, u = −K·x̂, the states estimated by an observer (or a Kalman filter) from the few that are measured. The gains come from where you want the closed-loop poles, or from weights on what matters (LQR). It can damp a swing or a resonance that no PID can see.',
    theory: String.raw`**State space.** Write the plant as first-order equations in all its states (actuator, positions, speeds, transmitter lags):

$$\dot x = Ax + Bu,\qquad y = Cx$$

A PID sees one output. State feedback uses all of $x$:

$$u = -Kx$$

and the closed loop $\dot x = (A - BK)x$ has the eigenvalues of $A - BK$. **If the plant is controllable** (the input reaches every state; the controllability matrix $[B\ AB\ \cdots\ A^{n-1}B]$ has full rank), $K$ can put them **anywhere**.

**Pole placement.** Choose the closed-loop poles, solve for $K$ (Ackermann's formula, or the better-conditioned Sylvester-equation method used here). In Loop Lab you choose a dominant pair $(\omega_n, \zeta)$. Lightly damped pairs (a swing, a resonance) keep their frequency but get damping $\zeta$, unstable poles are mirrored, and poles already faster stay put. Moving a pole a long way costs gain, and gain costs noise and margin.

**LQR.** Instead of poles, say what matters: minimize

$$J = \int_0^\infty \left(x^\top Q x + u^\top R u\right)dt$$

The answer is $K = R^{-1}B^\top X$ with $X$ from the Riccati equation $A^\top X + XA - XBR^{-1}B^\top X + Q = 0$. Here $Q$ puts weights $q_y$ on the PV error, $q_2$ on the secondary measurement and $q_i$ on the integral, against 1 on the output. LQR on its own has guaranteed margins (gain margin ∞, phase margin ≥ 60°) **with the states measured**.

**Observers.** The states usually aren't all measured. Run a copy of the model in the controller and correct it with what is measured:

$$\dot{\hat x} = A\hat x + Bu + L(y - C\hat x)$$

The estimation error obeys $\dot e = (A - LC)e$: $L$ is designed like $K$, on the dual system. That needs **observability** (the outputs see every state). A **Kalman filter** chooses $L$ from how noisy the measurement is against how much the plant gets pushed around.

**The separation principle.** The closed-loop poles are those of $A - BK$ plus those of $A - LC$: regulator and observer can be designed separately. But margins don't separate. LQR plus a Kalman filter (LQG) has **no** guaranteed margins: Doyle's counterexample (1978) has a gain margin as thin as you like. Always check the margins of the whole loop, broken at the plant input.

**No offset.** $u = -K\hat x$ alone leaves an offset under any constant upset. Two cures:
- **An integral of the error** as an extra state, fed back like the others. Simple, but it integrates during every transient and has to unwind afterwards: overshoot.
- **Estimate the disturbance** in the observer (a constant $d$ where it really acts, $\dot d = 0$) and cancel it in steady state. No windup, no overshoot from the integral; it needs the disturbance to be observable from what is measured.`,
    works: [
      'Lightly damped modes the measurement doesn\'t show directly: a crane\'s swinging load, a flexible shaft, a long boom or arm.',
      'Open-loop unstable plants (magnetic bearings, balancing), where the design has to be done from the model anyway.',
      'Plants with several measured states, each telling the controller something the main PV can\'t.',
      'Anywhere the model is good and the payoff is speed: positioning, motion, drive trains.',
    ],
    breaks: [
      'Model wrong: the observer\'s estimate drifts away from the plant, and the controller acts on fiction. Check the estimate against a measurement.',
      'Something unobservable or uncontrollable from the chosen sensors and actuator: no gain can fix it (a crane with only the load position can\'t tell wind from a trolley offset).',
      'A disturbance the observer doesn\'t know about: it explains it with the wrong states (the crane chases the wind).',
      'Observer or regulator poles too fast for the controller cycle, the actuator or the noise: the margins collapse even though the poles look fine.',
      'The plant is nonlinear and moves away from the design point: the gains are for one linearization.',
    ],
    tuning: String.raw`1. **Get the model right first.** Bump tests, a frequency sweep for any resonance, the physical constants. The design is only as good as $A$ and $B$.
2. **Choose what to measure** so every state is observable, including any disturbance to be estimated.
3. **Regulator.** Pole placement: start with $\omega_n$ around what a PI could do, $\zeta \approx 0.7$–0.8, and raise $\omega_n$ until the output effort or the margins say stop. LQR: start with $q_y$ = 1 per % and raise it by decades; put weight $q_2$ on a swing you want damped.
4. **Observer.** Two to three times faster than the regulator, or a Kalman filter with a sensible ratio of upsets to noise. Faster isn't better: it passes more noise and needs a better model.
5. **Offset:** prefer estimating the disturbance where it acts; use an integral of the error if you can't model one.
6. **Check the whole loop:** margins at the plant input, the tests with model mismatch, and the observer's estimate against a real reading.`,
    implementation: String.raw`- **Discretize the whole controller** for the PLC cycle (here: the continuous design, then a zero-order-hold discretization of the observer). Change the cycle and the matrices must be regenerated.
- **Feed the observer the output actually applied**, after the limits. Then it doesn't wind up, and with the disturbance estimate, nothing does.
- **Precision.** Observer matrices have entries a hair away from 1: use LReal (64-bit), not Real.
- **Deviation variables.** Everything is relative to the design point (the output, measurements and setpoint there); store those values with the matrices.
- **Manual and bumpless:** in manual, set the estimate to the steady state matching the measurement, and the integral or disturbance estimate so the output equals the manual value.
- **Watch the estimate.** Trend the observer's estimate of the PV next to the real reading. When they part company, the model is wrong.`,
    siemens: String.raw`- **No standard block.** PID_Compact, PID_Temp and PID_3Step are PIDs. State feedback is custom SCL: the exported **LL_StateFb** is one FB with the matrices as LReal arrays, about $2n^2$ multiply-adds per cycle (a few µs on an S7-1500).
- **Cyclic interrupt** (OB30–38) at the design cycle; for motion, an isochronous OB synchronized to PROFINET IRT.
- **Drives** carry their own versions: speed-loop observers, active vibration damping, and anti-sway packages for cranes. Use those where they exist; they run faster than any PLC.
- Generate the matrices offline (MATLAB, Python, or this page) and load them as DB start values; document the model and the design point next to them.`,
    broad: String.raw`- **IEC 61131-3:** the same FB in Structured Text, arrays of LREAL; CODESYS and TwinCAT run it as is.
- **Motion controllers and drives** (servo, crane, robot) are where state feedback and observers live in industry, mostly hidden behind parameters.
- **MPC** is the next rung: the same model, but the controller plans ahead and respects limits explicitly instead of saturating.`,
  },
  multiloop: {
    summary: 'A PID on each variable, each driving one valve. The relative gain array says which valve should go with which variable; a static decoupler cancels the steady interaction, so each loop sees only its own variable.',
    theory: String.raw`**Multi-loop (decentralized) control** is the plant default for several variables: one PID per variable, each on one valve. It works when each valve mostly moves its own variable. When it doesn't, closing one loop changes the process the other loop sees.

**The relative gain array (RGA)** measures that, from the steady-state gain matrix $G$ alone:

$$\Lambda = G \circ (G^{-1})^\top,\qquad \lambda_{11} = \frac{1}{1 - \dfrac{g_{12}g_{21}}{g_{11}g_{22}}}\ \ (2\times 2)$$

$\lambda_{ij}$ is the gain from valve $j$ to variable $i$ with the other loops open, divided by the same gain with them closed (perfectly). Rows and columns add up to 1.
- **Pair on relative gains close to 1.**
- **Never pair on a negative one:** closing the other loops would reverse the sign, and the loop goes unstable when they close (or open).
- **Around 0.5,** no pairing is good: the loops will fight whatever you choose.

**Static decoupler.** Put a matrix between the PIDs and the valves so the plant they see is diagonal at steady state. The simplified form keeps each loop on its own valve and adds a little of the other loop's output:

$$u_a = w_1 + c_a w_2,\quad u_b = w_2 + c_b w_1,\qquad c_a = -\frac{g_{1b}}{g_{1a}},\ c_b = -\frac{g_{2a}}{g_{2b}}$$

Each loop then sees its own gain divided by its relative gain (1.6× here, at λ = 0.64), so check its tuning again. A **dynamic** decoupler adds lead-lags for the transients; the static one gets most of the benefit.

**Better than a decoupler: change the variables.** If the physics gives you combinations that don't interact (total flow and ratio, energy and mass), control those. It decouples exactly, at every operating point.`,
    works: [
      'Two or three interacting variables with relative gains between about 0.6 and 1.5.',
      'Blending (level and composition, flow and temperature), evaporators, dryers, boilers (pressure and level).',
      'When the operators should still be able to put one loop in manual and understand the other.',
    ],
    breaks: [
      'Relative gains near 0.5 or below: the loops fight whatever the tuning.',
      'A negative relative gain on the chosen pairing: unstable when another loop is in manual (or saturated).',
      'One valve saturates: its loop is effectively open, the decoupler\'s assumption is wrong, and the other loop sees a different plant.',
      'The gains move with the operating point: a decoupler designed at one recipe is wrong at another.',
    ],
    tuning: String.raw`1. **Bump test each valve** with the other loops in manual: the full gain matrix (and the dynamics).
2. **RGA** at the operating points you run. Pick the pairing with relative gains closest to 1, positive.
3. **Tune each loop alone** (SIMC on its own pair), then close both and watch them interact.
4. If they fight: **detune** the less important loop (make it 3–5× slower), or **add the decoupler** and retune on the decoupled plant.
5. Check with each loop in manual in turn, and with a valve at its limit.`,
    implementation: String.raw`- Run both PIDs in the same OB, then the decoupler, then write both valves.
- **Bumpless:** in manual, undo the decoupler: solve for the PID outputs that give the present valve positions, and track those.
- **Windup:** when a valve saturates, hold the integral of the loop that drives it (and consider switching the decoupler off).
- Keep the decoupler gains in a DB next to the operating point they were measured at.`,
    siemens: String.raw`- Two **PID_Compact** instances, one per variable; the decoupler is your own SCL between them and the valves.
- PID_Compact's manual mode with ManualValue = the tracked value keeps the transfer bumpless.
- For a fixed recipe set, store a decoupler per recipe and switch with the recipe.`,
    broad: String.raw`- **DCS:** standard PID blocks plus calculation blocks for the decoupler; some vendors ship a 2×2 decoupling block.
- **Ratio and total-flow structures** are the common plant-floor answer for blending: see the ratio rung.
- **MPC** is the next step when there are more variables, constraints and changing priorities.`,
  },
  mpc: {
    summary: 'A model of the whole plant predicts where every variable is heading; every cycle, the controller plans the next few moves of all the valves to bring every variable to its setpoint at the least weighted cost, within the valves\' limits. It uses the first move and plans again next cycle.',
    theory: String.raw`**The receding horizon.** With a linear model $x_{k+1} = \Phi x_k + \Gamma u_k$, $y = Cx$ and the present state estimate, predict the outputs $P$ cycles ahead for any sequence of the next $M$ moves. Choose the moves that minimize

$$J = \sum_{i=1}^{P} \lVert y_{k+i} - r\rVert^2_{Q} + \sum_{j=0}^{M-1} \lVert \Delta u_{k+j}\rVert^2_{R}\quad \text{subject to}\quad u_{min} \le u \le u_{max}$$

then apply only the first move, and do it all again next cycle with fresh measurements. That's a small quadratic program each cycle (here $2M$ numbers).

**What the pieces do.**
- **Prediction horizon $P$:** long enough to see where each move leads.
- **Control horizon $M$:** how many moves it plans; after that the valves are assumed to stay.
- **Weights $Q$** (per output): which variable matters more.
- **Move weight $R$:** how gently the valves may move. It is the main speed knob.
- **Constraints:** the valve limits are part of the problem. It never plans a move it can't make, and when it can't have everything, the weights decide what gives.

**Offset-free.** A model is never exact. The observer (here a Kalman filter) estimates a constant load at each valve alongside the states, and the plan includes it. That does the integral action's job. (The older "offset on each output" model works too, but is slow on load changes.)

**Without constraints** active, MPC is a linear controller (an LQR with a finite horizon, plus the observer). The constraints are what make it different, and what make it hard to analyse with Bode and margins: judge it on tests, including model mismatch.`,
    works: [
      'Several interacting variables, with limits that bind often: distillation, reactors, compressors, utilities, whole units.',
      'Changing priorities: hold the quality, let the level float within its limits.',
      'Slow processes with dead time and a good model, where a few % of throughput is worth an engineer\'s time.',
    ],
    breaks: [
      'A poor model, or one that goes out of date when the plant changes: MPC is only as good as its model.',
      'Fast loops (a flow, a pressure): the PLC cycle and the optimization don\'t keep up. MPC usually sits above PID loops and writes their setpoints.',
      'No one on site who understands it: it gets switched off and the PIDs underneath take over.',
      'Feasibility: when the setpoints can\'t all be met, the result depends on the weights. Choose them for that case, not just for the nominal one.',
    ],
    tuning: String.raw`1. **Model first:** step tests on every input, every output, at the operating points you run.
2. **Horizon:** $P$ around the time the slowest response takes to settle (here 100 cycles, 200 s); $M$ of 3–10.
3. **Weights:** start with equal weights in % of span; raise the one that matters more. **Test the case where not everything can be met**: that is where the weights really decide.
4. **Move weight $R$:** raise it until the valves stop chasing noise, lower it until the response is fast enough.
5. **Observer:** how quickly it attributes errors to loads (here the "upsets" setting). Too fast passes noise, too slow leaves offsets that last.`,
    implementation: String.raw`- **Every cycle:** read the measurements, update the observer with the outputs actually applied, compute the QP's linear term, solve, write the first move.
- **The solver** here is projected Gauss–Seidel (each planned move in turn, clipped to its limits): a few hundred multiply-adds per sweep, simple enough for SCL. Industrial MPCs use active-set or interior-point solvers.
- **Warm start** from last cycle's plan, shifted by one.
- **Manual and bumpless:** track the valves and estimate the loads that explain the readings, so auto starts from where the plant is.
- **Watchdog:** if the solver doesn't finish or the model is flagged bad, fall back to the PID loops.`,
    siemens: String.raw`- **S7-1200/1500 (TIA Portal):** no standard MPC block. The exported **LL_Mpc** is the whole controller in SCL with its matrices as LReal arrays, fine for a small problem at a cycle of seconds.
- **SIMATIC PCS 7** has a small MPC in its Advanced Process Library (**ModPreCon**), and larger ones as an APC option.
- Larger MPCs usually run on a PC or an edge device, reading the measurements and writing setpoints to PID loops in the PLC over OPC UA.`,
    broad: String.raw`- **Industrial MPC** packages (in every major DCS vendor's portfolio) handle dozens of variables, economic optimization layered on top, and model identification tools.
- **Embedded and fast MPC** (explicit MPC, code-generated solvers) runs in drives and automotive controllers at kHz rates.
- MPC is where control meets optimization: the same machinery schedules energy and production.`,
  },
  adaptive: {
    summary: 'A PI that keeps measuring the plant and retunes itself: recursive least squares fits a simple model to what the loop does, and a tuning rule turns that model into gains, every cycle. It follows a plant that changes, as long as the loop gives it something to learn from.',
    theory: String.raw`**A self-tuning regulator** (indirect adaptive control) does on line what an engineer does with a bump test:
1. **Estimate** a model from the recent data: here $y(k) = a\,y(k-1) + b\,u(k-1-d) + c$, a first-order model with the dead time $d$ assumed.
2. **Design** the controller from it, as if it were true (*certainty equivalence*): here SIMC, $K = b/(1-a)$, $\tau = -T_s/\ln a$, $K_c = \tau/(K(\tau_c + \theta))$, $T_i = \min(\tau, 4(\tau_c + \theta))$.

**Recursive least squares** updates the estimate with each new sample, weighting old data down by a **forgetting factor** $\lambda$ (it remembers about $1/(1-\lambda)$ samples):

$$\hat\theta_k = \hat\theta_{k-1} + K_k\,(y_k - \varphi_k^\top\hat\theta_{k-1}),\quad K_k = \frac{P_{k-1}\varphi_k}{\lambda + \varphi_k^\top P_{k-1}\varphi_k},\quad P_k = \frac{(I - K_k\varphi_k^\top)P_{k-1}}{\lambda}$$

**What can go wrong**, and it is why adaptive control is rare on plant floors:
- **No excitation.** In a steady loop the data says nothing about the plant, but forgetting keeps discarding what it knew. The covariance grows, the estimate drifts, and the next upset meets strange gains ("bursting"). The guards here: learn only when the signals move by more than the noise, bound $P$, and keep the gains within 5× of the start.
- **Wrong structure.** A first-order fit to a second-order plant is biased, and the bias depends on what the loop is doing.
- **Closed-loop identification:** the controller's own feedback correlates input and noise.

**MRAC** (model reference adaptive control) is the other family: adjust the gains directly so the loop follows a reference model (the MIT rule, Lyapunov designs). It is elegant on paper, but harder to trust.`,
    works: [
      'A plant whose gain or speed changes slowly and predictably: batch stages, wear, fouling, a catalyst ageing.',
      'Loops that see enough movement (setpoint changes, regular upsets) to keep the estimate honest.',
      'As an advisor: estimate and display, let a person accept the new tuning.',
    ],
    breaks: [
      'Long quiet periods with forgetting on: the estimate wanders and the loop detunes (or worse) on nothing.',
      'Fast changes: it learns more slowly than the plant moves.',
      'Unmodelled dynamics or dead time error: the fitted model is biased, and so are the gains.',
      'Nobody on site can say what it is doing at 3 a.m.',
    ],
    tuning: String.raw`1. **Start it from a sound tuning:** it should be safe even if it never learns anything.
2. **Dead time:** measure it; the estimator doesn't.
3. **Forgetting:** remember a few of the plant's slowest time constants (λ = 0.995 at a 2 s cycle remembers about 7 minutes).
4. **Guards:** the dead zone (noise level), gain bounds, and a freeze switch.
5. **Watch the estimate** (gain, time constant) on the HMI for a few weeks before trusting it.`,
    implementation: String.raw`- **Order each cycle:** run the PID with the present gains, then update the estimator with this cycle's data and compute the next gains.
- **Freeze** learning in manual, on a bad measurement, and when the operator asks.
- **Log** every gain change: it is a controller changing its own tuning.`,
    siemens: String.raw`- **PID_Compact / PID_Temp** have pretuning and fine tuning: identification runs **on demand**, not continuously. For a batch you can trigger fine tuning per batch stage, which is a gain schedule in practice.
- For **continuous** adaptation: the exported **LL_SelfTune** next to the PID, writing Gain and Ti into the PID's parameters each cycle.
- **PCS 7** has an adaptive / model-based block set in its Advanced Process Library; most DCSs have some self-tuning option.`,
    broad: String.raw`- **Commercial self-tuners** (in single-loop controllers and DCSs) mostly retune on demand or on detected changes, not every sample, with heavy guarding.
- **Gain scheduling** is usually preferred when the change is predictable: it is adaptive control with the learning done once, by the engineer.`,
  },
  adrc: {
    summary: 'Active disturbance rejection: an extended state observer estimates everything acting on the PV besides the controller (unmodelled dynamics, loads, nonlinearity) as one "total disturbance", and the control law cancels it. It needs little model: the plant\'s order and a rough gain b₀.',
    theory: String.raw`**The idea** (Han, then Gao's linear form): write the plant as $n$ integrators,

$$y^{(n)} = b_0\,u + f,$$

and put everything you don't know or don't want to model into $f$, the **total disturbance**: the rest of the dynamics, loads, the reaction heat in a reactor, the error in $b_0$.

**The extended state observer (ESO)** adds $f$ as an extra state and estimates it with the output and its derivatives:

$$\dot z = \begin{bmatrix}0 & 1 & \\ & \ddots & 1\\ & & 0\end{bmatrix} z + \begin{bmatrix}0\\ b_0\\ 0\end{bmatrix} u + L\,(y - z_1),$$

with all observer poles at $-\omega_o$: $L = \left[\binom{n+1}{1}\omega_o,\ \binom{n+1}{2}\omega_o^2,\ \ldots\right]$.

**The law** cancels the estimate and closes a simple loop on what is left:

$$u = \frac{k_p(r - z_1) - k_d z_2 - z_{n+1}}{b_0},\qquad k_p = \omega_c^2,\ k_d = 2\omega_c\ \ (n = 2;\ k_p = \omega_c\ \text{for}\ n = 1)$$

so the plant behaves like $n$ integrators under a PD, with poles at $-\omega_c$.

**Three knobs, all with meaning:** $\omega_c$ (how fast), $\omega_o$ (how quickly disturbances are estimated, 3–10 × $\omega_c$), and $b_0$ (how hard the output pushes, within a factor of two or so). Linear ADRC *is* a linear controller, a particular two-degree-of-freedom PID with a filter, so the usual margins apply. Its appeal is the tuning: by bandwidth, without a full model.`,
    works: [
      'Plants whose dynamics change or aren\'t well known, but whose order and rough gain are: motion, drives, thermal systems.',
      'Disturbances that act like an extra force or heat: the ESO sees them through their effect and cancels them.',
      'Where you want to tune by bandwidth instead of by Kc, Ti, Td.',
    ],
    breaks: [
      'A big lag that isn\'t in its order: an order-1 ADRC on a plant with a slow jacket in the way loses its margins.',
      'Dead time: the ESO sees the effect late, so the cancellation comes late.',
      'b₀ far off, or the wrong sign: too small and it is violent, too large and sluggish.',
      'Noise: a fast observer differentiates it into the output.',
      'Ramps: plain ADRC lags them (add the reference\'s derivatives as feedforward).',
    ],
    tuning: String.raw`1. **Order:** 1 if the plant looks like an integrator or a first-order lag near the bandwidth you want, 2 if there are two lags (a reactor behind a jacket, a mass on a motor).
2. **b₀:** from a step test, the initial slope per % (order 1) or curvature per % (order 2). Auto-tune here reads it off the frequency response at 4× the bandwidth.
3. **ω_c:** as fast as the dead time and the lags allow; check Ms.
4. **ω_o:** 3–10 × ω_c, limited by noise and the controller cycle.`,
    implementation: String.raw`- **Discretize the ESO** for the cycle (exactly, as here, or by Euler at a fast cycle).
- **Feed the observer the output actually applied** (after the limits): that is the anti-windup.
- **Bumpless:** in manual, set $z_1 = y$, derivatives to 0 and $f = -b_0 u$.
- **Trend $f$:** it is a free estimate of everything acting on the process (on the reactor it moves with the reaction heat).`,
    siemens: String.raw`- No standard ADRC block in TIA Portal: the exported **LL_Adrc** is a small SCL FB (an observer of n + 1 states and a gain row).
- Motion libraries and some drives have disturbance observers of the same family (load torque estimation); there they are a parameter, not code.`,
    broad: String.raw`- ADRC is used in motion control, power electronics and some process applications; it is common in recent academic and Asian industrial work.
- It belongs with **disturbance observers** (DOB) and **internal model control**: estimate what is acting, and cancel it.`,
  },
  custom: {
    summary: 'Write the controller yourself in IEC 61131-3 Structured Text, run it on the bench against any process and test, and export it as an FB for TIA Portal or any IEC 61131-3 PLC.',
    theory: String.raw`**A controller is a program that runs every cycle.** Every rung on the ladder is one: a PID is a few lines of arithmetic with a memory (the integral). Writing it out makes three things concrete:
- **State:** what it remembers between cycles (here, anything in a VAR block).
- **The cycle:** everything happens once per **TS** seconds, from the measurement it read to the output it writes.
- **The edges:** limits, windup, manual mode, a bad input. That is where most of the code in a real controller goes.

**What the code can use**
- **Reads:** SP and PV in engineering units; SP_PCT and PV_PCT in % of span (on a 2×2 process also PV2, SP2 and their %); TS, TIME, MANUAL and MAN_OUT.
- **Writes:** OUT, in % (and OUT2 on a 2×2 process).
- **Statements:** IF, FOR, WHILE, REPEAT, assignments.
- **Functions:** the standard ones (ABS, SQRT, EXP, LN, MIN, MAX, LIMIT, SEL, TRUNC, the *_TO_* conversions), with named arguments like LIMIT(MN := 0.0, IN := u, MX := 100.0).

It starts as the process's PI, written out in full: change it, run it, compare it with the built-in controllers on the same tests and scorecard.`,
    works: [
      'Trying a variation the ladder doesn\'t have: a nonlinear gain, a deadband, a different anti-windup, a sequence.',
      'Checking your own PLC code against a process before it goes near the plant.',
      'Learning: write the PID yourself and see that it matches the built-in one.',
    ],
    breaks: [
      'No manual tracking: the switch to auto bumps.',
      'Integrating into a limit (windup): handle it, as the starting PI does.',
      'Code that depends on the cycle time without using TS: it changes behaviour when the OB changes.',
      'An endless loop: here it is stopped after 100 000 steps and the valve held; in a PLC the cycle-time watchdog stops the CPU.',
    ],
    tuning: String.raw`Your code, your numbers. The scorecard, the margins (where the code is a PID in disguise, the PID rung shows them) and the mismatch test are the same as for every other controller. Use them.`,
    implementation: String.raw`- **One FB, called every cycle**, from a cyclic interrupt OB.
- **Every variable that must survive a cycle is static** (VAR); temporaries can be VAR_TEMP in the PLC.
- **Bumpless manual:** the starting PI shows the pattern: in manual, set the integral so the output equals the manual value.
- **Test the edges:** a sensor freeze, the valve at a limit, manual and back. The bench's tests include them.`,
    siemens: String.raw`- The export wraps your code as **LL_Custom**: the built-in names become VAR_INPUT / VAR_OUTPUT, your VAR its statics, and in SCL every local gets its # prefix. Paste it into an external source file and compile it into a block.
- Call it from **OB30** at the cycle you tested with; the call site computes the % inputs from your analog tags.`,
    broad: String.raw`- The same code runs in **CODESYS, TwinCAT** and any IEC 61131-3 runtime (the ST export, without # prefixes).
- **PLCopen** has standard motion and process function blocks; your own FB is how anything else gets done.`,
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
/** The batch reactor's self-tuning PI. */
const ADAPT = (): ControllerConfig => defaultController('adaptive', getProcess('batch'));
/** The flow loop's PI written out in Structured Text, and the same without its edges (no anti-windup, no tracking). */
const STPI = defaultCustomCode(getProcess('flow'));
const STPI_BARE = `// The same PI without its edges: no anti-windup, no manual tracking.
VAR
  Kc : REAL := 0.45;
  Ti : REAL := 1.8;
  I : REAL;
  e : REAL;
END_VAR

e := SP_PCT - PV_PCT;
I := I + Kc * TS / Ti * e;
OUT := LIMIT(MN := 0.0, IN := Kc * e + I, MX := 100.0);
`;
/** The mixing tank's two loops (SIMC each, direct pairing), with changes. */
const ML = (extra: Partial<Extract<ControllerConfig, { kind: 'multiloop' }>> = {}): ControllerConfig => ({ ...(defaultController('multiloop', getProcess('mixing')) as Extract<ControllerConfig, { kind: 'multiloop' }>), ...extra });
/** The mixing tank's MPC, with changes. */
const MPC = (extra: Partial<Extract<ControllerConfig, { kind: 'mpc' }>> = {}): ControllerConfig => ({ ...(defaultController('mpc', getProcess('mixing')) as Extract<ControllerConfig, { kind: 'mpc' }>), ...extra });
/** The process's checked state-feedback design, with changes. */
const SF = (id: ProcessId, extra: Partial<Extract<ControllerConfig, { kind: 'statefb' }>> = {}): ControllerConfig => ({ ...(defaultController('statefb', getProcess(id)) as Extract<ControllerConfig, { kind: 'statefb' }>), ...extra });

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
  {
    id: 'surge-averaging',
    process: 'surge',
    title: 'The surge tank: averaging level control',
    question: 'A level loop that holds its setpoint perfectly and is still doing the wrong job. What should a buffer tank\'s controller actually do?',
    family: 'pid-wins',
    steps: [
      {
        title: 'The situation',
        body: String.raw`T-601 sits between an upstream section that swings its throughput and a downstream section that wants a steady feed. P-601 and LV-601 set the outflow. The tank holds 12 m³, and at 1.5 m there are 6 m³ of room each way.

The **mechanical view** shows how long that room lasts for a given imbalance: about 24 minutes for a 15 m³/h swing.`,
      },
      {
        title: 'Baseline: a level loop tuned like any other',
        body: String.raw`SIMC on the integrating model gives a tight PI ($K_c \approx 6$, $T_i \approx 7.5$ min, inverted).

The level is a picture of good control: it stays within about ±0.2 m of 1.5 m. But look at the valve. **The outflow copies the inflow**: it swings from 17 to 81 % (10 to 48 m³/h) and changes by up to 13 m³/h in a minute. The downstream section gets every upstream swing, just a little later. The tank's 12 m³ are not being used.`,
        presets: [{ label: 'Tight PI', controller: PI(6, 450, { invert: true }) }],
        scenarios: ['surges', 'batch-dumps'],
      },
      {
        title: 'Averaging control: use the room',
        body: String.raw`Decide how far the level may move: say a quarter of the span (0.75 m) for an upset of a quarter of the outlet's capacity (15 m³/h). The Lambda rule for integrating processes then gives the arrest time

$$\lambda = \frac{e\cdot\Delta h_{max}}{k'\,\Delta} \approx 33\ \text{min}$$

and from it $K_c \approx 0.73$, $T_i \approx 65$ min. **Auto-tune** does exactly this on this process.

**Result.** The level now wanders between 0.9 and 2.2 m. The outflow moves between 37 and 70 % and never faster than about 1.6 m³/h per minute: **eight times gentler**. Valve travel drops from 21 to under 3 strokes an hour.

**The scorecard's IAE is several times worse.** That isn't a failure, it's the point: IAE measures distance from setpoint, and for a buffer tank that is the wrong goal.`,
        presets: [
          { label: 'Tight PI', controller: PI(6, 450, { invert: true }) },
          { label: 'Averaging PI', controller: PI(0.73, 3920, { invert: true }) },
        ],
        scenarios: ['surges', 'batch-dumps', 'noisy'],
      },
      {
        title: 'P-only, and where the limits come in',
        body: String.raw`Many surge tanks run **P-only**: $K_c = 1/(k'\lambda) \approx 0.37$. The level settles wherever the flows balance, and that offset doesn't matter in a buffer. The outflow is smoother still, about 0.7 m³/h per minute at most.

The cost is room. P-only lets the level reach 2.4 m in the surge test, and 2.5 m (of 3) on the model mismatch test, where the tank is effectively 30 % smaller.

So on a real tank the limits get their own protection: a **high-level override** that opens the outlet, or a trip. That isn't a reason to tighten the loop.`,
        presets: [
          { label: 'Averaging PI', controller: PI(0.73, 3920, { invert: true }) },
          { label: 'Averaging P-only', controller: PI(0.37, 0, { invert: true }) },
        ],
        scenarios: ['surges', 'mismatch'],
      },
      {
        title: 'A high-level override',
        body: String.raw`A long surge (half an hour near full rate) is more than the averaging controller should absorb: the level climbs to 2.76 m of a 3 m tank.

Add a second, tight level controller with its setpoint at 2.4 m ($K_c = 6$, $T_i = 7.5$ min) and high-select the two outputs, because the override wants *more* outflow. With tracking, it sits idle until the level reaches 2.4 m, then takes the valve. The level stops at 2.5 m: the outflow has to swing up to 100 % first, so set the limit with margin.

**The other side of tracking.** When the surge ends, the averaging controller takes the valve back from where the override left it, near 100 %. Being slow, it takes a while to bring the outflow down, and the level dips to 0.66 m. A low-level override would catch that too.`,
        presets: [
          { label: 'Averaging PI', controller: PI(0.73, 3920, { invert: true }) },
          { label: 'Averaging + high-level override', controller: { kind: 'override', pid: { ...DEFAULT_PID, Kc: 0.73, Ti: 3920, invert: true }, ovr: { ...DEFAULT_PID, Kc: 6, Ti: 450, invert: true }, on: 'pv', limit: 2.4, select: 'max', tracking: true } },
        ],
        scenarios: ['big-surge'],
      },
      {
        title: 'Verdict',
        body: String.raw`**A slow PI or P-only, tuned from the room the tank has.**
- Choose the arrest time from the allowed level swing, not from the loop's speed.
- Judge the loop by how smooth the outflow is, and whether the level stays inside its limits.
- Protect the limits with an override or a trip.

This is PID winning: nothing up the ladder does the job better, as long as the tuning matches what the tank is for.`,
      },
    ],
  },
  {
    id: 'feeder-smith',
    process: 'feeder',
    title: 'The belt feeder: dead time and the Smith predictor',
    question: 'Thirty seconds of belt between the screw and the scale. How much faster can a controller that predicts the measurement be, and what happens when its prediction is wrong?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A screw feeder (SC-701, on a VFD) drops material onto a belt, and the belt scale WT-701 weighs it 30 s later. The screw itself answers in about 4 s.

Bump test: $K \approx 0.8$, $\tau \approx 5.5$ s, $\theta \approx 33$ s. The dead time is six times the lag. The **mechanical view** shows the two curves: what leaves the screw, and what the scale sees.`,
      },
      {
        title: 'Baseline: PI, as fast as it safely goes',
        body: String.raw`SIMC with $\tau_c = \theta$ gives $K_c \approx 0.1$, $T_i = 5.5$ s: almost pure integral action. That's the right shape for a dead-time dominant process.
- Rate changes settle in about 90 s, with a few percent of overshoot.
- Density upsets recover in about two minutes.
- Ms is 1.8.

**Auto-tune** for a PI is more careful still ($\tau_c = 3\theta$, $K_c \approx 0.05$) and doesn't settle at all within the 200 s between rate changes.`,
        presets: [
          { label: 'PI (τc = 3θ, auto)', controller: PI(0.0525, 5.5) },
          { label: 'PI (τc = θ)', controller: PI(0.1, 5.5) },
        ],
        scenarios: ['sp-steps', 'density'],
      },
      {
        title: 'Smith predictor',
        body: String.raw`Give the controller a model: $K_m = 0.8$, $\tau_m = 5.5$ s, $\theta_m = 32.8$ s (the **Fill from the plant** button). The PI inside now sees only the 5.5 s lag.

Tuned for $\tau_c = \max(\tau, \theta/2) \approx 16$ s, it gets $K_c \approx 0.41$, four times the plain PI's gain.

**Result.**
- Rate changes settle in about 57 s instead of 90 s, and the setpoint IAE falls from 29 to 13.
- On the bench, the trend shows a dashed "predicted" line: what the PID sees, 33 s ahead of the scale.
- Density upsets peak just as high (nothing can see them before the scale), but recover in 70–95 s instead of 110–130 s.

**The cost.** Four times the gain passes four times the scale noise to the VFD: 78 %/min of activity instead of 20.`,
        presets: [
          { label: 'PI (τc = θ)', controller: PI(0.1, 5.5) },
          { label: 'Smith predictor', controller: { kind: 'smith', pid: { ...DEFAULT_PID, Kc: 0.41, Ti: 5.5 }, model: { K: 0.8, tau: 5.5, theta: 32.8 } } },
        ],
        scenarios: ['sp-steps', 'density', 'noisy'],
      },
      {
        title: 'When the model is wrong',
        body: String.raw`Someone slows the belt: the dead time is now 25 % longer than the model's, and the screw has worn (15 % less capacity).

The Smith predictor tuned with $\tau_c = \theta/2$ shrugs it off: about 5 % overshoot, still settling faster than the PI.

Now tune the PI inside the predictor for the lag alone ($K_c = 1.2$), which is what the theory seems to allow. On the true plant its setpoint IAE is less than half again. On the slowed belt, **it overshoots by 27 % and takes nearly five minutes to settle.** The model error acts like dead time the PI doesn't know about.

The robustness rows show it before you ever run the test: Ms 2.4 against 2.0.`,
        presets: [
          { label: 'Smith (τc = θ/2)', controller: { kind: 'smith', pid: { ...DEFAULT_PID, Kc: 0.41, Ti: 5.5 }, model: { K: 0.8, tau: 5.5, theta: 32.8 } } },
          { label: 'Smith (tuned for the lag only)', controller: { kind: 'smith', pid: { ...DEFAULT_PID, Kc: 1.2, Ti: 5.5 }, model: { K: 0.8, tau: 5.5, theta: 32.8 } } },
          { label: 'PI (τc = θ)', controller: PI(0.1, 5.5) },
        ],
        scenarios: ['mismatch', 'sp-steps'],
      },
      {
        title: 'Verdict',
        body: String.raw`**A Smith predictor roughly halves the IAE on this loop, if the dead time is known.**
- Calculate the model's dead time from the belt speed if the belt can change speed.
- Tune the PI inside it for robustness ($\tau_c$ around half the dead time), not for the lag alone.
- Keep the plain PI ($\tau_c = \theta$) as the fallback.

If rate changes are rare and the material varies more than the rate does, the PI alone is nearly as good, and anyone can maintain it.`,
      },
    ],
  },
  {
    id: 'drum-three-element',
    process: 'drum',
    title: 'The boiler drum: why three-element control exists',
    question: 'More steam makes the level rise. More feedwater makes it fall. How do you control a level that lies to you, and what does each extra measurement buy?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A steam drum: feedwater in through FV-502, steam out to the turbine, and the level must stay within about ±300 mm, or the boiler trips.

The level reading includes the steam bubbles in the water. The **mechanical view** shows a 10 t/h step each way, valve fixed:
- **More steam:** the level *rises* by up to 30 mm (swell) before it falls.
- **More feedwater:** it *dips* by up to 20 mm (shrink), and is only back where it started after about 40 s.`,
      },
      {
        title: 'Single element: level only',
        body: String.raw`A level PI is fighting a process whose first response has the wrong sign. The shrink is a right-half-plane zero, about 46 s of effective dead time. SIMC on that gives $K_c \approx 0.7$, $T_i \approx 12$ min (Ms 1.4).

**Result.** A 15 t/h load increase swells the level, the controller *cuts* feedwater, and the level then drops about 100 mm. A 25 t/h load cut takes it 160 mm the other way. Neither has recovered five minutes later.

**Ignoring the shrink** gives $\theta \approx 11$ s and a PI three times as fast ($K_c \approx 2$, $T_i \approx 4.3$ min). Its swings are smaller, but Ms is 6, setpoint changes overshoot by 50 %, and on the mismatch test (low pressure, 50 % more swell) it slams the valve between 0 and 100 %.`,
        presets: [
          { label: 'Level PI (shrink counted)', controller: PI(0.7, 740) },
          { label: 'Level PI (shrink ignored)', controller: PI(2, 260) },
        ],
        scenarios: ['load-steps', 'mismatch'],
      },
      {
        title: 'Two elements: add steam-flow feedforward',
        body: String.raw`Measure the steam flow (FT-503), and move the feedwater with it: 1 t/h for 1 t/h, which is the mass balance. On an integrating process the feedforward gain is the ratio of the ramp rates; **Design from model** finds the same 1 %/(t/h).

**Result.** Load steps now show little more than the swell itself: about 20–35 mm instead of 100–160 mm, back within a few minutes. The level PI only trims.

A dip in feedwater pump pressure still costs 67 mm, because nothing measures the feedwater.`,
        presets: [
          { label: 'Level PI', controller: PI(0.7, 740) },
          { label: 'Level PI + steam feedforward', controller: { kind: 'feedforward', pid: { ...DEFAULT_PID, Kc: 0.7, Ti: 740 }, ff: [{ from: 'qs', gain: 1, lead: 0, lag: 0 }] } },
        ],
        scenarios: ['load-steps', 'fw-pressure'],
      },
      {
        title: 'Three elements: and a feedwater flow loop',
        body: String.raw`Put a flow loop on the feedwater (FT-502 → FIC-502 → FV-502). The level controller and the steam feedforward now set its *setpoint*, in t/h: 0.83 % of the 120 t/h span per t/h of steam.

**Result.**
- **Pump pressure dips:** the flow loop corrects them in seconds, and the level barely moves (3 mm instead of 67).
- **Load steps:** as good as two-element.
- **Total IAE:** down from 430 to about 107.

The level controller is now a slow trim on a mass balance, which is all a level that lies to you can be trusted with.

**The cost.** About twice the valve activity, from the flow loop chasing a noisy flow signal.`,
        presets: [
          { label: 'Level PI', controller: PI(0.7, 740) },
          { label: 'Cascade (no feedforward)', controller: { kind: 'cascade', outer: { ...DEFAULT_PID, Kc: 0.6, Ti: 740 }, inner: { ...DEFAULT_PID, Kc: 1, Ti: 2.5 }, ff: [] } },
          { label: 'Three-element', controller: { kind: 'cascade', outer: { ...DEFAULT_PID, Kc: 0.6, Ti: 740 }, inner: { ...DEFAULT_PID, Kc: 1, Ti: 2.5 }, ff: [{ from: 'qs', gain: 0.833, lead: 0, lag: 0 }] } },
        ],
        scenarios: ['load-steps', 'fw-pressure', 'mismatch'],
      },
      {
        title: 'Verdict',
        body: String.raw`**Three-element control, because each element fixes one physical problem:**
- **Steam flow feedforward** for the load, which the level reports the wrong way round.
- **The feedwater flow loop** for the pump pressure.
- **A slow level trim** for everything else.

Single-element is still used at low load, where the steam flow measurement is unreliable; switch over bumplessly above 20–30 % load.

The same pattern fits any level with inverse response or a dominant measured flow: feed forward the mass balance, close a flow loop, trim on level.`,
      },
    ],
  },
  {
    id: 'hx-steam-limit',
    process: 'hx',
    title: 'The heat exchanger: a steam limit, and why trackers matter',
    question: 'The boiler can only spare 1000 kg/h. How do you control the temperature without ever taking more, and what goes wrong when the limiter isn\'t built right?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`The steam heat exchanger from the cascade case. Now the boiler house says this exchanger may take at most 1000 kg/h. At full production, holding 60 °C needs about 1100.

Someone has to give, and it should be the temperature, not the boiler. The test pushes the process flow up 40 % for four minutes, then drops it below normal.`,
      },
      {
        title: 'No limit',
        body: String.raw`The temperature PI does its job: the outlet dips to 53 °C and recovers. To do it, it takes **1120 kg/h** of steam, 12 % over the allowance, for as long as the high flow lasts.

In a real plant the boiler pressure would sag and every other user would feel it.`,
        presets: [{ label: 'PI', controller: PI(1.5, 29) }],
        scenarios: ['steam-limit'],
      },
      {
        title: 'Override on steam flow, with tracking',
        body: String.raw`Add a steam flow controller (FT-301 → FIC-301) with setpoint 1000 kg/h. Low-select its output with the temperature controller's, because the limiter wants *less* steam when it acts.

Both controllers track the selected output (external reset). Each one's integral follows the valve signal, so the one not in charge sits just its own P action away.

**Result.**
- Steam now stops at about 1000 kg/h. The temperature settles at 55.9 °C, exactly what the energy balance allows on 1000 kg/h at that flow.
- When the flow drops, the temperature controller takes the valve straight back. The outlet peaks at 71 °C and is back within about 100 s.

On the valve chart, the dashed line is the limiter's own output: where it meets the valve signal, the limiter is in charge.`,
        presets: [
          { label: 'PI', controller: PI(1.5, 29) },
          { label: 'Override, tracking', controller: { kind: 'override', pid: { ...DEFAULT_PID, Kc: 1.5, Ti: 29 }, ovr: { ...DEFAULT_PID, Kc: 1.8, Ti: 2.25 }, on: 'pv2', limit: 1000, select: 'min', tracking: true } },
        ],
        scenarios: ['steam-limit'],
      },
      {
        title: 'The same override without tracking',
        body: String.raw`Now each controller integrates its own error whether or not it has the valve. This is what two PID_Compacts and a MIN() give you if nothing else is done.

**Taking over.** While the temperature is fine, the limiter's flow is below its setpoint, so it winds up to 100 %. When the steam reaches 1000 kg/h it has to come down from there first: steam overshoots to **1060 kg/h** before it catches.

**Handing back.** While the limiter is in charge, the temperature is below setpoint, so the temperature controller winds up to 100 %. When the flow drops, it holds the valve open until it has unwound. The outlet overshoots to **77 °C** (instead of 71) and takes 137 s to come back (instead of about 100).

Neither controller is badly tuned. The structure is.`,
        presets: [
          { label: 'Override, tracking', controller: { kind: 'override', pid: { ...DEFAULT_PID, Kc: 1.5, Ti: 29 }, ovr: { ...DEFAULT_PID, Kc: 1.8, Ti: 2.25 }, on: 'pv2', limit: 1000, select: 'min', tracking: true } },
          { label: 'Override, no tracking', controller: { kind: 'override', pid: { ...DEFAULT_PID, Kc: 1.5, Ti: 29 }, ovr: { ...DEFAULT_PID, Kc: 1.8, Ti: 2.25 }, on: 'pv2', limit: 1000, select: 'min', tracking: false } },
        ],
        scenarios: ['steam-limit'],
      },
      {
        title: 'Verdict',
        body: String.raw`**An override with tracking.**
- The limit controller gets the valve exactly when its variable reaches the limit.
- Tracking (external reset feedback, or at least manual-tracking of the idle controller) is what makes the takeover and the hand-back clean.
- Pick the selector by asking which way the limiter pushes.
- Set the limit a little inside the real one, and show which controller has the valve.

The same structure fits high-level overrides, compressor surge and motor-current limits.`,
      },
    ],
  },
  {
    id: 'jacket-split',
    process: 'jacket',
    title: 'The reactor: split-range heating and cooling',
    question: 'One temperature controller, a steam valve and a cooling water valve. Why does a loop that was fine during start-up start hunting once the reaction is running?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`R-501 needs steam to get warm and cooling water once the reaction runs. TIC-501's output is split: 0–50 % opens the cooling water (fully open at 0), 50–100 % opens the steam.

The **mechanical view** plots the heat into the jacket against the controller output. The line is three and a half times steeper on the cooling side: per % of output, cooling water moves far more heat than steam.`,
      },
      {
        title: 'Tuned during start-up, on steam',
        body: String.raw`The loop was commissioned while heating up the first batch, so it was tuned on the steam side: SIMC with $\tau_c = \theta$, $K_c = 11$, $T_i = 180$ s. On steam it is fine.

Once the reaction needs cooling, the loop gain is 3.5 times higher, and the linear analysis says the loop is **unstable** on that side. In the simulation it doesn't run away: every swing back across the split puts it on the low-gain side again. Instead it **hunts**, bouncing the output between cooling water and steam. Valve travel is 14 strokes an hour, three times a well-behaved loop's, with steam and cooling water fighting each other.`,
        presets: [{ label: 'PI tuned on steam', controller: PI(11, 180) }],
        scenarios: ['load-swing', 'near-split'],
      },
      {
        title: 'Detune for the cooling side',
        body: String.raw`The usual fix on site: lower the gain until the cooling side is calm. Tuned on the cooling side ($K_c = 3.2$, $T_i = 170$ s), the loop is stable everywhere with Ms 2.3.

The steam side is now sluggish. Setpoint steps that need steam overshoot by about 23 % and take 10–12 minutes to settle.`,
        presets: [
          { label: 'PI tuned on steam', controller: PI(11, 180) },
          { label: 'PI tuned on cooling', controller: PI(3.2, 170) },
        ],
        scenarios: ['sp-steps', 'load-swing'],
      },
      {
        title: 'Balance the split',
        body: String.raw`Give the cooling valve more of the range: split at about 76 %, the ratio of the two capacities, $Q_{c}/(Q_c + Q_h) = 800/(800 + 250)$. Now each % of output moves about 10 kW on either side. One SIMC tuning ($K_c = 4.9$, $T_i = 170$ s) fits both.

**Result.**
- Setpoint steps overshoot 5–8 % on both sides, settling in 5–9 minutes.
- Load swings are rejected with 40 % less IAE than the detuned loop.
- Ms is the same 2.4 everywhere.

The **characterized** controller does the same thing in software: it maps the controller's output onto the two valves at the balance point, so the valves' split can stay at 50 %. The two give identical results.`,
        presets: [
          { label: 'PI tuned on cooling', controller: PI(3.2, 170) },
          { label: 'Balanced split (76 %)', controller: PI(4.9, 170), params: { split: 76 } },
          { label: 'Characterized output', controller: { kind: 'characterized', pid: { ...DEFAULT_PID, Kc: 4.9, Ti: 170 }, char: 'balanced-split' } },
        ],
        scenarios: ['sp-steps', 'load-swing'],
      },
      {
        title: 'The gap',
        body: String.raw`A gap between the ranges (both valves shut over a band) stops steam and cooling water ever being on together. It is also a dead zone.

With a 6 % gap, a reactor running near the split wanders four times more (IAE 8 instead of 2): the controller has to integrate across the gap before either valve moves. Valve activity doubles as it hops across.

The characterization can jump the gap in software, but then a tiny change in output moves a valve by a step. Keep the gap as small as the valves' shut-off allows.`,
        presets: [
          { label: 'Balanced, no gap', controller: PI(4.9, 170), params: { split: 76 } },
          { label: 'Balanced, 6 % gap', controller: PI(4.9, 170), params: { split: 76, gap: 6 } },
        ],
        scenarios: ['near-split'],
      },
      {
        title: 'Verdict',
        body: String.raw`**Balance the split, then tune one PI.**
- Put the split point where both ranges move the same heat per % (or characterize the output in the PLC), keep the gap small, and tune once.
- If the cooling capacity changes a lot with the seasons, re-check the balance in summer and winter.

The ladder's rung here is characterization, not anything fancier: the problem is a nonlinearity in the actuators, so straighten it.`,
      },
    ],
  },
  {
    id: 'blend-ratio',
    process: 'blend',
    title: 'Blending: ratio control',
    question: 'Production sets the diluent flow, and the product must stay at 10 % whatever it does. Feedback, feedforward, or ratio, and why does it matter which?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A 50 % concentrate is dosed into a diluent stream to make a 10 % product. The diluent flow (FT-801) is set upstream and swings with production, from 25 to 60 m³/h. An analyzer reads the product 20 s downstream.

The **mechanical view** shows the key fact. At a fixed concentrate flow the product moves with every rate change. At a fixed *ratio*, it doesn't move at all.`,
      },
      {
        title: 'Feedback only',
        body: String.raw`A PI from the analyzer to the concentrate valve ($K_c = 0.4$, $T_i = 38.5$ s).

Every production change is a 2–5 %-point upset on the product (11–27 % of the span): off spec for four to six minutes, because the analyzer only sees it 25 s later. A concentrate flow loop underneath (cascade) changes nothing here: the upset doesn't pass through the concentrate flow.`,
        presets: [{ label: 'PI', controller: PI(0.4, 38.5) }],
        scenarios: ['throughput', 'strength'],
      },
      {
        title: 'Fixed ratio',
        body: String.raw`Let FIC-802 follow the diluent: setpoint = 0.25 × FT-801. No analyzer in the loop at all.

**Result.** Production changes now barely touch the product: under 2.5 % of span, settled within about a minute.

But a weaker concentrate delivery (45 % instead of 50) leaves the product **1 %-point low for good**, because nothing measures it. Grade changes are impossible without someone retyping the ratio.`,
        presets: [
          { label: 'PI', controller: PI(0.4, 38.5) },
          { label: 'Fixed ratio 0.25', controller: { kind: 'ratio', outer: { ...DEFAULT_PID, Kc: 0.5, Ti: 38.6 }, inner: { ...DEFAULT_PID, Kc: 0.88, Ti: 1.75 }, trim: false, ratio: 0.25, rLo: 0, rHi: 0.5 } },
        ],
        scenarios: ['throughput', 'strength'],
      },
      {
        title: 'Ratio with an analyzer trim',
        body: String.raw`Let AIC-803 set the ratio (0–0.5) from the analyzer. Tune the flow loop first, then the trim on a step in $R$ ($K_c = 0.5$, $T_i = 39$ s).

**Result.**
- Production changes stay under 1 % of span.
- A new concentrate strength is found and corrected by the trim, as fast as feedback alone could.
- Total IAE drops from 321 to 118.`,
        presets: [
          { label: 'PI', controller: PI(0.4, 38.5) },
          { label: 'Ratio + trim', controller: { kind: 'ratio', outer: { ...DEFAULT_PID, Kc: 0.5, Ti: 38.6 }, inner: { ...DEFAULT_PID, Kc: 0.88, Ti: 1.75 }, trim: true, ratio: 0.25, rLo: 0, rHi: 0.5 } },
        ],
        scenarios: ['throughput', 'strength', 'mismatch'],
      },
      {
        title: 'Why not additive feedforward?',
        body: String.raw`Feedforward from FT-801 to the valve (1 % per m³/h, designed from the model) handles production changes almost as well as ratio. The difference shows when the plant runs away from the design rate.
- **At 40 % rate,** the feedforward loop's trim sees a process gain three times higher: grade changes overshoot 28–32 %. The ratio trim overshoots 10–13 %.
- **At 160 % rate,** the feedforward trim is too slow to settle in seven minutes. The ratio trim settles in under five.
- **On the mismatch test,** ratio's IAE is a third of feedforward's.

Ratio keeps the trim's gain constant. What still changes with rate is the mixing time ($V/F$, 96 s at low rate against 22 s at high), which no structure can remove.`,
        presets: [
          { label: 'PI + feedforward', controller: { kind: 'feedforward', pid: { ...DEFAULT_PID, Kc: 0.4, Ti: 38.5 }, ff: [{ from: 'FA', gain: 1, lead: 0, lag: 0 }] } },
          { label: 'Ratio + trim', controller: { kind: 'ratio', outer: { ...DEFAULT_PID, Kc: 0.5, Ti: 38.6 }, inner: { ...DEFAULT_PID, Kc: 0.88, Ti: 1.75 }, trim: true, ratio: 0.25, rLo: 0, rHi: 0.5 } },
        ],
        scenarios: ['low-rate', 'high-rate', 'mismatch'],
      },
      {
        title: 'Verdict',
        body: String.raw`**Ratio control with a quality trim.**
- When the product depends on a proportion and the throughput is set elsewhere, hold the proportion.
- Use the analyzer to correct the proportion, not the flow.
- Limit the ratio range, cut off at low wild flow, and hold the ratio when the analyzer faults.`,
      },
    ],
  },
  {
    id: 'crane-antisway',
    process: 'crane',
    title: 'The crane: a swing PID can\'t see',
    question: 'A load on a rope swings every time the trolley moves. Can a PID put it down quickly and hanging still, and if not, what can?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`An overhead crane carries a 10 t load on an 8 m rope along a 40 m bay. The trolley drive follows a speed reference; a camera on the trolley reads the sway angle, and the load position is the trolley encoder plus the rope's offset. The **mechanical view** shows the problem: run the trolley and stop it, and the load swings with a 5.7 s period for minutes. The load's position is what matters, so that is the PV.`,
      },
      {
        title: 'Baseline: a PI on the load position',
        body: String.raw`About the fastest PI that stays stable: $K_c = 0.2$, $T_i = 100$ s. It is painfully slow (a minute after the order to move 20 m, the load has covered 12) and the load is still swinging by about 2° when the test ends. A gust leaves it swinging by 4°.`,
        presets: [{ label: 'PI on the load', controller: PI(0.2, 100) }],
        scenarios: ['moves', 'gust'],
      },
      {
        title: 'Why it can\'t go faster',
        body: String.raw`In the **control view**, the plant has a pair of poles at $-0.006 \pm 1.1j$: the swing, with a resonance peak of about 40 dB. Any PI fast enough to matter has gain around 1.1 rad/s, and with 180° of phase lag after the peak, the swing grows instead of dying out. Raise $K_c$ to 0.5 and watch it.

The PI has no way to damp the swing: it only knows how far the load is from where it should be. Damping needs the sway **rate**, and moving the trolley under the load to take the swing out, as a crane driver does.`,
        presets: [{ label: 'PI on the load', controller: PI(0.2, 100) }, { label: 'PI, a bit faster', controller: PI(0.5, 200) }],
        scenarios: ['moves'],
      },
      {
        title: 'State feedback with an observer',
        body: String.raw`Feed back all four mechanical states: trolley position and speed, sway angle and sway rate. Pole placement puts the dominant pair at $\omega_n = 0.5$ rad/s, $\zeta = 0.8$, and moves the swing to $\zeta = 0.8$ at its own frequency. A Kalman filter estimates the speeds and the wind from the camera and the load position.

The 20 m move now takes 23 s (at 1 m/s top speed it can't take much less than 20), and the load arrives hanging still: 0.09° of swing left. A 1 m positioning move settles in 5.5 s. The gust moves the load less than a metre and it is back in 8 s. Look at the controller output: the trolley moves *under* the load.`,
        presets: [{ label: 'PI on the load', controller: PI(0.2, 100) }, { label: 'State feedback', controller: SF('crane') }],
        scenarios: ['moves', 'inching', 'gust'],
      },
      {
        title: 'Why the observer has to know about the wind',
        body: String.raw`Wind holds the load at an angle: 2.3° for 4 kN on 10 t. To a controller that wants zero sway, that is a swing to take out, and it keeps driving the trolley to do it.
- **With nothing to remove offset**, the gust drags the load almost 8 m along the bay.
- **With an integral of the error**, the gust costs nearly 4 m, and the integral winds up during every move: 1 m moves overshoot by more than half.
- **Estimating the wind** in the observer tells the controller what steady sway to expect, so it holds the load where it should be and leaves the integral out of the moves altogether.

An observer is a model: what it doesn't know about, it explains with the wrong states.`,
        presets: [
          { label: 'Estimating the wind', controller: SF('crane') },
          { label: 'No offset removal', controller: SF('crane', { integral: 'none' }) },
          { label: 'Integral of the error', controller: SF('crane', { integral: 'error', qi: 0.1 }) },
        ],
        scenarios: ['gust', 'inching'],
      },
      {
        title: 'A longer rope, and a missing camera',
        body: String.raw`**The rope.** Lower the load to 13 m and the swing is 27 % slower than the controller was designed for. The moves still settle in 22 s without overshoot: pole placement with a well-damped target leaves room. Further than that, real systems schedule the design on the hoist encoder.

**The camera.** Take it away (measure the load position only) and the wind can't be estimated at all: at rest, a wind with the trolley a little upwind looks exactly like no wind with the trolley where it should be. The design says so (choose "ZT-601 only" with "estimating the upset"). With an integral of the error instead it runs, but it overshoots 60 % on small moves. Observability is a property of the sensors, not of the controller.`,
        presets: [{ label: 'State feedback', controller: SF('crane') }, { label: 'Load position only, integral', controller: SF('crane', { integral: 'error', measure: 'pv' }) }],
        scenarios: ['long-rope', 'inching'],
      },
      {
        title: 'Verdict',
        body: String.raw`**State feedback, with a sway sensor and an observer that models the wind.** This is a place where PID genuinely can't do the job, because the thing to control (the swing) is a resonance the PV only shows when it is already too late.

The cost is real: a model (rope length, drive response), a sway camera, a design per rope length or a schedule over it, and an engineer to commission it. That's why crane builders sell anti-sway as a packaged function of the drive or motion controller rather than leaving it to each project.`,
      },
    ],
  },
  {
    id: 'servo-resonance',
    process: 'servo',
    title: 'The flexible shaft: damping a resonance',
    question: 'A shaft between motor and roll rings at 12 Hz. How fast can the roll speed be controlled, and what does it take to go faster?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A motor turns a heavy roll through a long shaft. The drive makes torque; encoders read the motor speed and the roll speed. The **mechanical view** shows a torque step with no controller: both speed up, with the shaft winding up and springing back at 11.6 Hz on top, barely damped.`,
      },
      {
        title: 'Baseline: a PI on the roll speed',
        body: String.raw`$K_c = 0.8$, $T_i = 1$ s, about the most this loop takes. A 250 rpm speed change takes over a second, a 60 N·m load step pulls the roll down by 10 % of span, and the roll keeps ringing at the resonance throughout.`,
        presets: [{ label: 'PI on the roll', controller: PI(0.8, 1) }],
        scenarios: ['speed-steps', 'load-torque'],
      },
      {
        title: 'Why it can\'t go faster',
        body: String.raw`In the **control view**, the plant from torque to roll speed has the resonance at 73 rad/s with nothing in front of it: a 40 dB peak and 180° more phase lag. The PI has to keep its gain at 73 rad/s well below 1, so it crosses over at about 1.5 rad/s, fifty times slower than the shaft. Double the gain and the loop goes unstable at the resonance. Auto-tune says the same: SIMC's tuning is unstable here and has to be slowed down 25×.`,
        presets: [{ label: 'PI on the roll', controller: PI(0.8, 1) }, { label: 'PI, gain ×2.5', controller: PI(2, 0.3) }],
        scenarios: ['speed-steps'],
      },
      {
        title: 'What drives do: cascade on the motor speed',
        body: String.raw`Close a fast PI on the **motor** encoder ($K_c = 5$, $T_i = 0.05$ s), and the roll loop around it. Seen from the motor the phase never drops below −180°, so the inner loop can be fast. Speed changes now settle in about a second and the load step costs 0.7 %. That is the standard answer, and with a notch filter at the resonance on the torque reference it is usually enough.

Its weak spot: the outer loop's margins are thin (Ms 2.7), because the roll still rings at the anti-resonance, where the motor barely moves and the inner loop can't see it.`,
        presets: [{ label: 'PI on the roll', controller: PI(0.8, 1) }, { label: 'Cascade on the motor speed', controller: { kind: 'cascade', inner: { ...DEFAULT_PID, Kc: 5, Ti: 0.05 }, outer: { ...DEFAULT_PID, Kc: 2, Ti: 0.2 }, ff: [] } }],
        scenarios: ['speed-steps', 'load-torque'],
      },
      {
        title: 'State feedback: active damping',
        body: String.raw`Feed back both speeds and the shaft twist, estimated by a Kalman filter from the two encoders together with the load torque. Pole placement puts the dominant pole at 40 rad/s and moves the resonance pair to $\zeta = 0.7$ at its own frequency: the controller supplies the damping the steel doesn't have.

Speed changes settle in 0.35 s, three times faster than the cascade, with the same load rejection (0.8 %) and better margins (Ms 1.5). With a roll twice as heavy, overshoot is under 4 %.`,
        presets: [{ label: 'Cascade on the motor speed', controller: { kind: 'cascade', inner: { ...DEFAULT_PID, Kc: 5, Ti: 0.05 }, outer: { ...DEFAULT_PID, Kc: 2, Ti: 0.2 }, ff: [] } }, { label: 'State feedback', controller: SF('servo') }],
        scenarios: ['speed-steps', 'load-torque', 'heavy-roll'],
      },
      {
        title: 'Verdict',
        body: String.raw`**A cascade on the motor speed, plus a notch filter if it rings, for most machines. State feedback with an observer where speed changes are the product.**
- The PI on the roll alone is hopeless: the resonance caps it at 1.5 rad/s.
- The cascade is what every drive offers: robust, understood, tuned by technicians.
- State feedback is three times faster with better margins, but it needs the drive train's model (both inertias, the stiffness) and someone who can maintain it. Drives that offer observer-based "active damping" have packaged exactly this.`,
      },
    ],
  },
  {
    id: 'maglev-unstable',
    process: 'maglev',
    title: 'Magnetic levitation: an unstable plant',
    question: 'The plant falls (or jumps) on its own. What does that demand of the controller, and does it need anything beyond PID?',
    family: 'pid-wins',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A 2 kg armature hangs under an electromagnet at a 15 mm gap. The **mechanical view** shows why it can't stay there on its own: where the magnet's pull equals the weight, a little further down the pull is weaker and a little closer it is stronger. Linearized, the gap has a pole at +36 rad/s: any error doubles in 20 ms. The amplifier answers in 3 ms, and the controller runs every millisecond.

Try auto-tune on the PID: it refuses. Every tuning rule assumes a stable or integrating plant.`,
      },
      {
        title: 'A PID designed by hand',
        body: String.raw`The derivative is what stabilizes it: P alone makes a spring with no damping. Place the closed-loop pair well above 36 rad/s: $K_c = 4$, $T_d = 20$ ms (filtered), and a slow integral, $T_i = 150$ ms, for the weight it has to carry. With the setpoint weight at its default $b = 1$, every gap change kicks the coil: the armature overshoots by more than its step, 130 %. On the mismatch test it lands on the pad.`,
        presets: [{ label: 'PID, b = 1', controller: PI(4, 0.15, { Td: 0.02, a: 0.2, invert: true }) }],
        scenarios: ['gap-steps', 'mismatch'],
      },
      {
        title: 'Setpoint weighting',
        body: String.raw`Put only 30 % of the setpoint into the P term ($b = 0.3$; the D term already works on the measurement only). The loop's stability is unchanged; only the setpoint response is. Gap changes now settle in about 0.2 s without overshoot, half a kilogram of extra load dips the gap by 2 %, and the mismatch test passes.

The peak sensitivity is 3.1, high by the usual standards. For an unstable plant there is a lower limit on how robust the loop can be, set by the unstable pole and the delays, and this is near it.`,
        presets: [{ label: 'PID, b = 1', controller: PI(4, 0.15, { Td: 0.02, a: 0.2, invert: true }) }, { label: 'PID, b = 0.3', controller: PI(4, 0.15, { Td: 0.02, a: 0.2, b: 0.3, invert: true }) }],
        scenarios: ['gap-steps', 'added-mass', 'mismatch'],
      },
      {
        title: 'State feedback by pole placement',
        body: String.raw`The model is exactly what an unstable plant needs designed from anyway. Place the dominant pair at $\omega_n = 60$ rad/s, $\zeta = 0.8$; a Kalman filter estimates the falling speed (no differentiating of a noisy gap) and the extra load from the current it takes.

It settles about twice as fast (0.06–0.13 s), with a little more margin (Ms 2.4), and overshoots more on gap changes: up to 9 %, and 26 % on the mismatch test, because the setpoint feedforward assumes the magnet is as strong as it was.`,
        presets: [{ label: 'PID, b = 0.3', controller: PI(4, 0.15, { Td: 0.02, a: 0.2, b: 0.3, invert: true }) }, { label: 'State feedback', controller: SF('maglev') }],
        scenarios: ['gap-steps', 'added-mass', 'mismatch'],
      },
      {
        title: 'Verdict',
        body: String.raw`**PID is fine here: PD plus a slow integral, designed from the model, with a setpoint weight.** State feedback is no clear win on one axis.

What the unstable plant teaches:
- The loop has a **minimum speed**: it has to be faster than the unstable pole.
- So the hardware sets the limits: the controller cycle, the amplifier, the sensor. Real magnetic bearings run at 10–20 kHz.
- **No tuning rule applies**: design from the model, by pole placement or on the Bode plot.
- **The gain moves with the setpoint** (the pole runs from 50 rad/s at 8 mm to 30 at 22 mm), and saturating the amplifier at the wrong moment drops the load. Range, limits and trips matter as much as the tuning.`,
      },
    ],
  },
  {
    id: 'mixing-mimo',
    process: 'mixing',
    title: 'The mixing tank: two loops that fight',
    question: 'Hot and cold water set both the level and the temperature. Which valve should control what, and is it worth decoupling them, or handing both to an MPC?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A tank blends hot water (70 °C) and cold water (15 °C) and supplies the mix by gravity. Both its temperature and its level are controlled, at 35 °C and 1 m. The **mechanical view** shows the catch: either valve raises the level, and each pulls the temperature its own way.`,
      },
      {
        title: 'One loop: temperature on the hot valve',
        body: String.raw`A PI on the temperature, the cold valve left where it is. The temperature is fine, but the level goes wherever the flows take it: it moves by up to 64 cm when the temperature setpoint changes, and by up to 72 cm as the demand changes. A second loop is needed.`,
        presets: [{ label: 'PI on the temperature', controller: PI(3.26, 360) }],
        scenarios: ['temp-steps', 'demand'],
      },
      {
        title: 'Two loops, each tuned alone',
        body: String.raw`Add a PI on the level, on the cold valve, each loop tuned by SIMC on its own pair with the other open. Now watch the temperature when only the level setpoint moves: it swings by 6 °C, because the level loop's cold water hits the temperature, and the temperature loop's hot water then disturbs the level again. A 30 % demand change costs 3.8 °C.`,
        presets: [{ label: 'PI on the temperature', controller: PI(3.26, 360) }, { label: 'Two loops', controller: ML() }],
        scenarios: ['level-steps', 'demand'],
      },
      {
        title: 'Which valve for which variable? The relative gain',
        body: String.raw`The steady-state gains give the relative gain for "hot → temperature": $\lambda_{11} = (T_h - T)/(T_h - T_c)$, the cold share of the inflow. It is 0.64 at 35 °C: the right pairing, but with real interaction. At 55 °C it is 0.27, and the pairing should cross: the hot valve should hold the level and the cold valve the temperature.

The hot-recipe test runs at 55 °C. Paired the 35 °C way, a level change pulls the temperature by 7.3 °C; crossed, by 2.6 °C. The best pairing depends on the recipe.`,
        presets: [{ label: 'Two loops, direct', controller: ML() }, { label: 'Two loops, crossed', controller: ML({ pairing: 'crossed', pid: { ...DEFAULT_PID, Kc: 3.8, Ti: 360, invert: true }, pid2: { ...DEFAULT_PID, Kc: 18.1, Ti: 64 } }) }],
        scenarios: ['hot-recipe'],
      },
      {
        title: 'A static decoupler',
        body: String.raw`Between the PIDs and the valves, add $u_{hot} = w_1 + c_a w_2$ and $u_{cold} = w_2 + c_b w_1$ with $c_a = -g_{12}/g_{11}$, $c_b = -g_{21}/g_{22}$ from the bump-test gains. When the level loop opens the cold valve, the hot valve opens in proportion, so the temperature doesn't notice; and the other way round.

A level change now moves the temperature by 0.1 °C instead of 6, and the demand change by 0.03 °C instead of 3.8. Two numbers did that. The same thing done physically is to control total flow and hot fraction; that version is exact at any temperature.`,
        presets: [{ label: 'Two loops', controller: ML() }, { label: 'Two loops + decoupler', controller: ML({ decouple: true }) }],
        scenarios: ['level-steps', 'demand'],
      },
      {
        title: 'MPC',
        body: String.raw`An MPC with the linearized model at 35 °C, planning 5 moves of both valves over 200 s, equal weights, and a Kalman filter estimating a load at each valve. On interaction it is about as good as the decoupler (0.4 °C on the level change, 0.15 °C on demand). It is faster on temperature steps (IAE 17 against 67) and better when the hot water cools (0.7 °C against 1.6 °C), because it sees the load directly rather than waiting for the error.`,
        presets: [{ label: 'Two loops + decoupler', controller: ML({ decouple: true }) }, { label: 'MPC', controller: MPC() }],
        scenarios: ['temp-steps', 'hot-supply', 'level-steps'],
      },
      {
        title: 'When not everything can be met',
        body: String.raw`At 50 °C, demand goes to 120 %. Holding 1 m at 50 °C would need more hot water than FV-901 can pass, so something has to give.
- **Two plain loops** let the temperature sag to 47 °C. When demand falls again, the temperature overshoots to 55 °C as the hot loop unwinds.
- **The decoupler** and **MPC with equal weights** also settle at about 47 °C and 1 m, but recover cleanly.
- **MPC with the temperature weighted 10×** holds 48.4 °C and lets the level float down to 0.92 m instead.

Only MPC lets you say which variable gives. A PID structure would need an override for that.`,
        presets: [{ label: 'Two loops', controller: ML() }, { label: 'MPC, equal weights', controller: MPC() }, { label: 'MPC, temperature first', controller: MPC({ q1: 10 }) }],
        scenarios: ['peak'],
      },
      {
        title: 'Verdict',
        body: String.raw`**For one tank: decouple.** Check the relative gain, pair accordingly, and add a static decoupler, or better, restructure to total flow and hot fraction. Two numbers remove almost all the interaction.

**MPC** matches it on interaction and wins on load upsets and at the limits, where its weights decide what gives. On a single tank that rarely pays for a model someone has to keep right. On a unit with many interacting variables and constraints that bind every day, it does, which is why refineries and chemical plants run it.

**Either way, the operating point matters:** the relative gain runs from 0.82 at 25 °C to 0.27 at 55 °C, so a decoupler or a model taken at one recipe is off at another.`,
      },
    ],
  },
  {
    id: 'batch-adaptive',
    process: 'batch',
    title: 'The batch reactor: one plant at the start, another at the end',
    question: 'An exothermic batch makes the reactor slow and touchy while the reactant lasts and easy afterwards. Does it need adaptive control or ADRC, or a PI tuned for the right stage, and where do controllers stop being the answer?',
    family: 'escalation',
    steps: [
      {
        title: 'The situation',
        body: String.raw`A 2 m³ reactor, a reaction that gives off up to 500 kW, and a jacket on a temperature control unit. Each batch: charge at 40 °C, heat up at 2 °C/min to 80 °C, hold while it reacts, cool down. The **mechanical view's** Semenov diagram shows what matters: early in the batch, the reaction heat grows almost as fast with temperature (48 kW/K) as the jacket can take it away (60 kW/K).`,
      },
      {
        title: 'A PI commissioned on a quiet batch',
        body: String.raw`Tuned (SIMC) near the end of a batch, when the reaction is nearly over: Kc 0.88, Ti 252 s. On a whole batch it looks fine. The heat-up lags by 11 °C and the hold is steady. But the **control view** at the start of the batch says Ms 2.6, and the strong batch (more reactant, a fresher catalyst) overshoots 80 °C by 2.4 °C. The plant it was tuned on is 4.5 times less sensitive than the one it meets.`,
        presets: [{ label: 'PI (quiet batch)', controller: PI(0.88, 252) }],
        scenarios: ['batch', 'hot-batch'],
      },
      {
        title: 'Tune for the start instead',
        body: String.raw`SIMC on the start-of-batch model ($K = 3.9$, $\tau = 12$ min): Kc 0.47, Ti 736 s. Ms 1.3 where it matters, no overshoot, but now it is slow all the time: it lags the heat-up ramp by 26 °C. The usual compromise is this tuning plus a slower ramp, or a feedforward from the ramp rate.`,
        presets: [{ label: 'PI (quiet batch)', controller: PI(0.88, 252) }, { label: 'PI (start of batch)', controller: PI(0.47, 736) }],
        scenarios: ['batch', 'early-hold'],
      },
      {
        title: 'A self-tuning PI',
        body: String.raw`Start from the quiet-batch tuning and let it learn: recursive least squares fits a first-order model as the batch runs, and SIMC retunes from it every cycle. Probe **Kc** on the block diagram to watch it move. The strong batch no longer overshoots, and at the start of a batch it settles on gains with Ms 1.4.

Now look at the late-batch test: with little movement to learn from, its estimate wanders and it detunes itself to Kc 0.25. That is the adaptive controller's classic weakness, and why plants that use it guard it heavily or let it only advise.`,
        presets: [{ label: 'PI (quiet batch)', controller: PI(0.88, 252) }, { label: 'Self-tuning PI', controller: ADAPT() }],
        scenarios: ['hot-batch', 'late-hold'],
      },
      {
        title: 'ADRC',
        body: String.raw`A second-order ADRC: an observer estimates the temperature, its rate and the "total disturbance" (here, mostly the reaction heat) and cancels it. It needs only $b_0$, read from the plant around its bandwidth. It holds the start of a batch with Ms 1.6 and no overshoot, with no model of the reaction at all. Probe **I** to see the total disturbance it cancels, as the output that takes: everything acting on the batch, the heat losses and the reaction included. Through the hold it climbs as the reaction dies away and less cooling is needed. Its weakness is ramps: it lags the heat-up by 22 °C.`,
        presets: [{ label: 'PI (start of batch)', controller: PI(0.47, 736) }, { label: 'ADRC', controller: { kind: 'adrc', order: 2, wc: 0.0054, wo: 0.016, b0: 3.16e-5 } }],
        scenarios: ['batch', 'early-hold'],
      },
      {
        title: 'Where controllers stop being the answer',
        body: String.raw`The scorecard's robustness row checks each controller against a ±20 % spread of reaction heat, jacket fouling and jacket lag. **Every one of them meets reactors in that spread that run away.** Where the reaction heat grows faster with temperature than the jacket can remove it, the cooling margin is gone. A loop can hold that only if it is fast enough and has cooling to spare, and these don't.

The fix is the recipe: dose the reactant instead of charging it all, heat up more slowly, keep the jacket clean. Then an independent high-temperature trip and emergency cooling, outside the control system.`,
      },
      {
        title: 'Verdict',
        body: String.raw`**A PI tuned for the hardest stage (the start of the hold, full charge), a heat-up ramp it can follow, and a recipe with a cooling margin.**
- Adaptive control follows the batch, but needs guarding against learning from quiet data.
- ADRC copes without a reaction model, at the price of lagging ramps and being one more unfamiliar block.
- Neither replaces the margin: that is chemistry and plant design, and the safety system's job when it is lost.`,
      },
    ],
  },
  {
    id: 'write-your-own',
    process: 'flow',
    title: 'Write your own controller',
    question: 'What is a controller, line by line? Write one in Structured Text, run it on the bench, and see how its edge cases show up in the tests.',
    family: 'pid-wins',
    steps: [
      {
        title: 'The PI, written out',
        body: String.raw`Pick **Your own (ST)** on the bench's controller list. It starts with the flow loop's PI written out in full: the error in % of span, the integral as a static, conditional integration for anti-windup, and tracking in manual. Run it and compare it with the built-in PI: the trends are identical, to the last decimal.`,
        presets: [{ label: 'Built-in PI', controller: PI(0.45, 1.8) }, { label: 'The same PI in ST', controller: { kind: 'custom', code: STPI } }],
        scenarios: ['sp-steps'],
      },
      {
        title: 'Leave out the edges',
        body: String.raw`The same PI with the anti-windup and the manual tracking taken out (eight lines shorter). Now every test starts with a bump. Without tracking, its integral starts at zero instead of where the valve is, so its first move slams the valve (up to 54 % overshoot, IAE ten times worse). When the valve saturates it winds up too. Most of a real controller's code is about these edges, not the PID formula.`,
        presets: [{ label: 'The PI in ST', controller: { kind: 'custom', code: STPI } }, { label: 'Without its edges', controller: { kind: 'custom', code: STPI_BARE } }],
        scenarios: ['sp-steps', 'saturation'],
      },
      {
        title: 'Now yours',
        body: String.raw`Open either in the bench and change it. Try a gain that grows with the error (error-squared PI), a deadband, a different anti-windup, or a setpoint ramp in the controller. The **Automation** view turns your code into an FB (**LL_Custom**) for TIA Portal (with # prefixes) or any IEC 61131-3 PLC, with the call site.`,
      },
    ],
  },
];

export const getCase = (id: string) => CASES.find((c) => c.id === id);
