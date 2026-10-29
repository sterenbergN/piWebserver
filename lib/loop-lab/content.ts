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
];

export const getCase = (id: string) => CASES.find((c) => c.id === id);
