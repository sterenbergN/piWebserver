# Daily question syllabus

Topics per track, with a weight (how often relative to the others: 3 = often,
1 = now and then). The generator rotates through them, favouring higher
weights and topics not seen for longest. Use the topic names as written, so
stats group them consistently. The site keeps the same list in
`lib/daily/syllabus.ts` (for "topics you haven't tried"): change both together.

## Mechanical
What a mechanical engineering bachelor's covers, the FE Mechanical and PE
Mechanical (Machine Design & Materials, Thermal & Fluid Systems, HVAC &
Refrigeration), and the fundamentals underneath.

| Topic | Weight | Ideas |
|---|---|---|
| Statics | 3 | beams, trusses, frames, friction, centroids, distributed loads |
| Mechanics of materials | 3 | axial, torsion, bending, shear, combined stress, Mohr's circle, columns |
| Machine design | 3 | shafts, bolts, welds, springs, bearings, gears, fatigue (Goodman), fits |
| Dynamics | 2 | kinematics, work–energy, impulse–momentum, rotating bodies, mechanisms |
| Thermodynamics | 3 | first and second law, cycles (Rankine, Brayton, refrigeration), mixtures, psychrometrics |
| Heat transfer | 2 | conduction, convection, radiation, fins, heat exchangers (LMTD, ε-NTU) |
| Fluid mechanics | 3 | Bernoulli, pipe losses, pumps (curves, NPSH, affinity laws), drag, compressible basics |
| HVAC & refrigeration | 1 | loads, psychrometric processes, COP, duct and fan basics |
| Vibrations | 2 | natural frequency, damping, forced response, isolation, balancing |
| Materials | 2 | stress–strain, hardness, heat treatment, failure modes, selection |
| Manufacturing & GD&T | 1 | tolerances, fits, datums, machining and welding basics |
| Engineering economics | 2 | P/F/A factors, NPV, payback, depreciation, comparing alternatives |
| Measurement | 1 | uncertainty, sensors, strain gauges, Wheatstone bridge |
| Circuits | 2 | DC/AC circuits, RC/RL transients, power, three-phase, motors |
| Mathematics | 2 | calculus, differential equations, linear algebra, probability and statistics |
| Chemistry & combustion | 1 | stoichiometry, air–fuel ratio, heating values, gas laws |

## Controls
Control theory from first principles to tuning real loops.

| Topic | Weight | Ideas |
|---|---|---|
| Modeling | 3 | ODE to transfer function, mechanical/electrical/thermal/fluid systems, linearization |
| Block diagrams | 2 | reduction, feedback, disturbances, Mason's rule |
| Time response | 3 | first and second order, overshoot, settling, dominant poles |
| Routh–Hurwitz | 2 | stability, gain ranges, oscillation frequency |
| Steady-state error | 2 | system type, error constants, final value theorem |
| Root locus | 2 | sketching rules, breakaway, gain for a damping ratio |
| Frequency response | 3 | Bode plots, gain and phase margin, bandwidth, Nyquist |
| Compensator design | 2 | lead, lag, lead–lag, notch |
| PID control | 3 | P/I/D effects, forms (ideal, parallel, series), anti-windup, derivative filtering, setpoint weighting |
| PID tuning | 2 | Ziegler–Nichols, relay autotune, SIMC/IMC from FOPDT, Cohen–Coon |
| On–off control | 1 | bang-bang, hysteresis, cycling, duty cycle |
| Digital control | 2 | sampling, aliasing, z-transform, ZOH, discretizing a PID |
| State space | 2 | forms, eigenvalues, controllability, observability, pole placement |
| Advanced loop structures | 1 | cascade, feedforward, ratio, split range, override |
| System identification | 1 | FOPDT from a step test, dead time, process gain |
| Nonlinearities | 1 | saturation, deadband, backlash, rate limits |

## Automation
What an automation engineer working with Siemens TIA Portal and industrial
systems meets.

| Topic | Weight | Ideas |
|---|---|---|
| IEC 61131-3 | 2 | languages, POUs, FB vs FC, instances, data types, standard FBs |
| TIA Portal | 3 | optimized blocks, multi-instances, PLC data types (UDTs), OBs and priorities, retentivity, libraries and versioning, software units, know-how protection |
| Timers, counters and edges | 2 | TON/TOF/TP/TONR, CTU/CTD, R_TRIG, scan-time effects |
| Ladder logic | 2 | seal-in, interlocks, fail-safe wiring, sequencers |
| State machines | 2 | step sequences in SCL, SFC/GRAPH, mode handling (auto/manual/stop) |
| ISA-88 batch control | 1 | physical, procedural and state models, phases |
| ISA-95 | 1 | levels, MES/ERP integration |
| HMI and alarms | 1 | ISA-101 high-performance HMI, ISA-18.2 alarm management |
| Analog I/O and scaling | 2 | 4–20 mA, NAMUR NE 43, NORM_X/SCALE_X, RTDs and thermocouples, HART |
| Industrial networks | 2 | PROFINET IO (RT/IRT, update times), PROFIsafe, Modbus TCP, OPC UA, IP planning |
| Drives | 2 | VFDs, V/f, slip, braking, encoders, technology objects |
| Motion and sensors | 1 | encoders, positioning, servo basics, sensor types |
| Machine safety | 2 | stop categories, e-stops, guards and interlocks, safe torque off |
| Functional safety | 2 | ISO 13849-1 (PL, categories, MTTFd, DC), IEC 62061 (SIL, PFH), F-CPUs and F-blocks |
| Electrical design | 1 | IEC 60204-1 / NFPA 79, 24 VDC power budgets, wire sizing, grounding |
| Testing and commissioning | 1 | PLCSIM, virtual commissioning, FAT/SAT, test cases |
| Industrial cybersecurity | 1 | IEC 62443 zones and conduits, access protection, hardening |
