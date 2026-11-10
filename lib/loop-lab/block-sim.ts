import { encodeExperiment, type Experiment } from './setup';
import { DEFAULT_PID, type PidParams } from './controllers';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BlockCategory = 'sources' | 'controllers' | 'dynamics' | 'math' | 'sinks';

export type BlockKind =
  | 'step'
  | 'ramp'
  | 'sine'
  | 'pulse'
  | 'noise'
  | 'constant'
  | 'pid'
  | 'leadlag'
  | 'gain'
  | 'integrator'
  | 'derivative'
  | 'fopdt'
  | 'sopdt'
  | 'deadtime'
  | 'valve'
  | 'nonlin_tank'
  | 'sum'
  | 'product'
  | 'saturation'
  | 'selector'
  | 'scope'
  | 'xy';

export type BlockNode = {
  id: string;
  kind: BlockKind;
  label: string;
  x: number;
  y: number;
  params: Record<string, number>;
  signs?: string; // used by 'sum', e.g. '+-', '++', '+--', '++-'
};

export type BlockWire = {
  id: string;
  fromBlock: string;
  fromPort: number;
  toBlock: string;
  toPort: number;
  label?: string;
};

export type BlockDiagramModel = {
  id: string;
  name: string;
  description: string;
  duration: number;
  dt: number;
  nodes: BlockNode[];
  wires: BlockWire[];
};

export type ScopeMetrics = {
  label: string;
  color: string;
  finalValue: number;
  peak: number;
  min: number;
  overshootPct: number;
  settleTime: number | null;
  iae: number;
};

export type BlockSimResult = {
  t: number[];
  nodeOutputs: Record<string, number[]>;
  scopeSeries: {
    id: string;
    title: string;
    series: { label: string; color: string; x: number[]; y: number[] }[];
    metrics: ScopeMetrics[];
  }[];
  xyPlots: {
    id: string;
    title: string;
    x: number[];
    y: number[];
    xLabel: string;
    yLabel: string;
  }[];
  summary: {
    effectiveK: number;
    effectiveTau1: number;
    effectiveTau2: number;
    effectiveTheta: number;
    integrating: boolean;
    controllerKc: number;
    controllerTi: number;
    controllerTd: number;
    loopClosed: boolean;
  };
};

export type ParamSpec = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hint: string;
};

export type BlockCatalogEntry = {
  kind: BlockKind;
  category: BlockCategory;
  name: string;
  shortSymbol: string;
  latex: (node: BlockNode) => string;
  description: string;
  intuition: string;
  inputs: string[];
  outputs: string[];
  paramSpecs: ParamSpec[];
};

// ─── Block Catalog Metadata ──────────────────────────────────────────────────

export const BLOCK_CATALOG: Record<BlockKind, BlockCatalogEntry> = {
  step: {
    kind: 'step',
    category: 'sources',
    name: 'Step Input',
    shortSymbol: 'u(t)',
    latex: (node) => {
      const { y0 = 0, y1 = 10, tStep = 2 } = node.params;
      return `y(t) = \\begin{cases} ${y0} & t < ${tStep}\\text{ s} \\\\[4pt] ${y1} & t \\ge ${tStep}\\text{ s} \\end{cases}`;
    },
    description: 'Generates a standard step transition from initial to final value at a specified trigger time.',
    intuition: 'The benchmark disturbance or setpoint excitation for measuring open-loop reaction rate, rise time, overshoot, and steady-state gain.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'y0', label: 'Initial value', unit: '', min: -100, max: 100, step: 0.5, default: 0, hint: 'Value before the step trigger' },
      { key: 'y1', label: 'Final value', unit: '', min: -100, max: 100, step: 0.5, default: 10, hint: 'Value after the step trigger' },
      { key: 'tStep', label: 'Step time', unit: 's', min: 0, max: 120, step: 0.5, default: 2, hint: 'Time when the step transition occurs' },
    ],
  },

  ramp: {
    kind: 'ramp',
    category: 'sources',
    name: 'Ramp Input',
    shortSymbol: 'r(t)',
    latex: (node) => {
      const { slope = 1, tStart = 2, y0 = 0 } = node.params;
      return `y(t) = ${y0} + ${slope} \\cdot \\max(0, t - ${tStart})`;
    },
    description: 'Linearly ramping signal with selectable slope and start delay.',
    intuition: 'Probes velocity tracking lag and integral action. Type 0 systems show infinite ramp error; Type 1 systems settle to a finite steady-state velocity lag.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'slope', label: 'Slope rate', unit: '/s', min: -20, max: 20, step: 0.1, default: 1, hint: 'Rate of change per second' },
      { key: 'tStart', label: 'Start time', unit: 's', min: 0, max: 120, step: 0.5, default: 2, hint: 'Delay before ramp commences' },
      { key: 'y0', label: 'Initial baseline', unit: '', min: -100, max: 100, step: 1, default: 0, hint: 'Starting value before start time' },
    ],
  },

  sine: {
    kind: 'sine',
    category: 'sources',
    name: 'Sine Wave Generator',
    shortSymbol: '~',
    latex: (node) => {
      const { amp = 5, freq = 0.5, bias = 0 } = node.params;
      return `y(t) = ${bias} + ${amp} \\cdot \\sin(${freq}\\,t)`;
    },
    description: 'Harmonic sinusoidal generator for frequency response and resonance testing.',
    intuition: 'Excites the loop across frequencies to observe physical amplitude attenuation and phase shift (Bode plot behavior) in real time.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'amp', label: 'Amplitude', unit: '', min: 0.1, max: 50, step: 0.5, default: 5, hint: 'Peak sinusoidal variation' },
      { key: 'freq', label: 'Frequency', unit: 'rad/s', min: 0.05, max: 10, step: 0.05, default: 0.5, hint: 'Angular frequency in radians per second' },
      { key: 'bias', label: 'DC Bias', unit: '', min: -100, max: 100, step: 1, default: 0, hint: 'Constant center offset' },
    ],
  },

  pulse: {
    kind: 'pulse',
    category: 'sources',
    name: 'Pulse / Square Wave',
    shortSymbol: '⎍',
    latex: (node) => {
      const { amp = 10, period = 20, duty = 50 } = node.params;
      return `y(t) = \\begin{cases} ${amp} & (t \\bmod ${period}) < ${((period * duty) / 100).toFixed(1)} \\\\ 0 & \\text{otherwise} \\end{cases}`;
    },
    description: 'Periodic square pulse train with adjustable amplitude, period, and duty cycle.',
    intuition: 'Repeatedly shocks the control loop with alternating positive and negative transients to assess repeatable recovery and settling.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'amp', label: 'Pulse amplitude', unit: '', min: 0.5, max: 50, step: 0.5, default: 10, hint: 'Pulse height above zero' },
      { key: 'period', label: 'Cycle period', unit: 's', min: 1, max: 120, step: 1, default: 20, hint: 'Total duration of one complete cycle' },
      { key: 'duty', label: 'Duty cycle', unit: '%', min: 5, max: 95, step: 5, default: 50, hint: 'Percentage of cycle spent at high amplitude' },
    ],
  },

  noise: {
    kind: 'noise',
    category: 'sources',
    name: 'Gaussian Noise',
    shortSymbol: 'w(t)',
    latex: (node) => {
      const { std = 0.5, seed = 42 } = node.params;
      return `w(t) \\sim \\mathcal{N}(0,\\, \\sigma^2 = ${(std * std).toFixed(3)}),\\quad \\text{seed}=${seed}`;
    },
    description: 'Pseudo-random Gaussian white noise generator with reproducible seed.',
    intuition: 'Emulates transmitter noise and process turbulence. Demonstrates how aggressive derivative and proportional gains amplify chatter onto the valve.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'std', label: 'Std deviation (σ)', unit: '', min: 0.01, max: 10, step: 0.05, default: 0.5, hint: 'Noise amplitude spread' },
      { key: 'seed', label: 'Random seed', unit: '', min: 1, max: 9999, step: 1, default: 42, hint: 'Fixed seed for deterministic reproducibility' },
    ],
  },

  constant: {
    kind: 'constant',
    category: 'sources',
    name: 'Constant Value',
    shortSymbol: 'C',
    latex: (node) => {
      const { value = 50 } = node.params;
      return `y(t) = ${value}`;
    },
    description: 'Static constant source for setpoints, baseline feed rates, or manual overrides.',
    intuition: 'Provides a fixed steady signal into summing junctions, limits, or setpoint tracks.',
    inputs: [],
    outputs: ['out'],
    paramSpecs: [
      { key: 'value', label: 'Constant value', unit: '', min: -200, max: 200, step: 0.5, default: 50, hint: 'Fixed scalar output' },
    ],
  },

  pid: {
    kind: 'pid',
    category: 'controllers',
    name: 'PID Controller (ISA)',
    shortSymbol: 'PID',
    latex: (node) => {
      const { Kc = 2.0, Ti = 12, Td = 0, N = 10, bias = 0 } = node.params;
      const iTerm = Ti > 0 ? ` + \\frac{1}{${Ti}s}` : '';
      const dTerm = Td > 0 ? ` + \\frac{${Td}s}{1 + ${(Td / Math.max(1, N)).toFixed(2)}s}` : '';
      return `u(t) = ${bias} + ${Kc} \\left[ e(t) ${iTerm} ${dTerm} \\right]`;
    },
    description: 'Standard ISA non-interacting PID controller with dynamic anti-windup clamping and filtered derivative.',
    intuition: 'Proportional gain Kc accelerates loop response; Integral time Ti eliminates steady-state offset; Derivative time Td adds predictive phase lead damping.',
    inputs: ['e'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'Kc', label: 'Gain (Kc)', unit: '', min: 0.05, max: 20, step: 0.05, default: 2.0, hint: 'Proportional gain (% output per error)' },
      { key: 'Ti', label: 'Integral time (Ti)', unit: 's', min: 0, max: 120, step: 0.5, default: 12, hint: 'Integration time; 0 disables integral action' },
      { key: 'Td', label: 'Derivative time (Td)', unit: 's', min: 0, max: 20, step: 0.1, default: 0, hint: 'Derivative prediction time constant' },
      { key: 'N', label: 'Deriv filter (N)', unit: '', min: 2, max: 30, step: 1, default: 10, hint: 'Derivative filter cutoff coefficient' },
      { key: 'uMin', label: 'Output low limit', unit: '%', min: -150, max: 50, step: 5, default: -100, hint: 'Anti-windup lower clamp limit' },
      { key: 'uMax', label: 'Output high limit', unit: '%', min: 50, max: 200, step: 5, default: 100, hint: 'Anti-windup upper clamp limit' },
      { key: 'bias', label: 'Output bias', unit: '%', min: -100, max: 100, step: 1, default: 0, hint: 'Zero-error baseline output' },
    ],
  },

  leadlag: {
    kind: 'leadlag',
    category: 'controllers',
    name: 'Lead-Lag Compensator',
    shortSymbol: '(s+a)/(s+b)',
    latex: (node) => {
      const { K = 1, Tlead = 8, Tlag = 15 } = node.params;
      return `G_{\\text{LL}}(s) = ${K} \\frac{${Tlead}s + 1}{${Tlag}s + 1}`;
    },
    description: 'Dynamic phase lead/lag network used in feedforward compensators and signal shaping filters.',
    intuition: 'When Tlead > Tlag, injects phase advance to anticipate incoming disturbances. When Tlag > Tlead, provides high-frequency low-pass smoothing.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'K', label: 'Compensator gain (K)', unit: '', min: -10, max: 10, step: 0.05, default: 1.0, hint: 'Static feedforward or filter gain' },
      { key: 'Tlead', label: 'Lead time (Tlead)', unit: 's', min: 0, max: 60, step: 0.5, default: 8, hint: 'Numerator time constant (anticipation)' },
      { key: 'Tlag', label: 'Lag time (Tlag)', unit: 's', min: 0.1, max: 60, step: 0.5, default: 15, hint: 'Denominator time constant (smoothing)' },
    ],
  },

  gain: {
    kind: 'gain',
    category: 'controllers',
    name: 'Scalar Gain',
    shortSymbol: '×K',
    latex: (node) => {
      const { K = 1.5 } = node.params;
      return `y(t) = ${K} \\cdot u(t)`;
    },
    description: 'Pure proportional amplifier or attenuator with instantaneous zero phase shift.',
    intuition: 'Multiplies any signal by scalar K. Essential in signal scaling, unit conversion, and loop decoupling networks.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'K', label: 'Gain factor (K)', unit: '', min: -20, max: 20, step: 0.05, default: 1.5, hint: 'Multiplier applied to incoming signal' },
    ],
  },

  integrator: {
    kind: 'integrator',
    category: 'controllers',
    name: 'Integrator (1/s)',
    shortSymbol: '1/s',
    latex: (node) => {
      const { K = 0.2, y0 = 0 } = node.params;
      return `y(t) = ${y0} + ${K} \\int_0^t u(\\tau)\\,d\\tau`;
    },
    description: 'Time accumulator with configurable gain, initial condition, and saturation boundaries.',
    intuition: 'Accumulates input over time with gain K. Introduces a pole at s=0 (-90° phase lag) and produces a continuous ramp for non-zero inputs.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'K', label: 'Integration gain (K)', unit: '1/s', min: 0.01, max: 5, step: 0.01, default: 0.2, hint: 'Ramp rate per unit input' },
      { key: 'y0', label: 'Initial value', unit: '', min: -100, max: 100, step: 1, default: 0, hint: 'Initial integrator state at t=0' },
      { key: 'min', label: 'Lower clamp', unit: '', min: -500, max: 0, step: 10, default: -100, hint: 'Minimum accumulator output' },
      { key: 'max', label: 'Upper clamp', unit: '', min: 0, max: 500, step: 10, default: 100, hint: 'Maximum accumulator output' },
    ],
  },

  derivative: {
    kind: 'derivative',
    category: 'controllers',
    name: 'Filtered Differentiator',
    shortSymbol: 's/(τs+1)',
    latex: (node) => {
      const { Td = 2, alpha = 0.1 } = node.params;
      return `G_{\\text{diff}}(s) = \\frac{${Td}s}{${(alpha * Td).toFixed(2)}s + 1}`;
    },
    description: 'Calculates the dynamic rate of change of the input signal with high-frequency noise roll-off.',
    intuition: 'Measures signal velocity while preventing high-frequency noise amplification through a first-order low-pass filter pole.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'Td', label: 'Derivative time (Td)', unit: 's', min: 0.1, max: 20, step: 0.1, default: 2.0, hint: 'Anticipation derivative time constant' },
      { key: 'alpha', label: 'Filter ratio (α)', unit: '', min: 0.01, max: 0.5, step: 0.01, default: 0.1, hint: 'Filter time constant ratio: τf = α · Td' },
    ],
  },

  fopdt: {
    kind: 'fopdt',
    category: 'dynamics',
    name: 'FOPDT Plant',
    shortSymbol: 'K/(τs+1)',
    latex: (node) => {
      const { K = 1.2, tau = 15, theta = 3 } = node.params;
      return `G(s) = \\frac{${K}}{${tau}s + 1} e^{-${theta}s}`;
    },
    description: 'First-Order Plus Dead Time (FOPDT) dynamic process model.',
    intuition: 'The benchmark industrial process model. Gain K determines final step amplitude; lag τ dictates exponential settling rate; dead time θ limits closed-loop feedback speed.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'K', label: 'Process gain (K)', unit: '%/%', min: -20, max: 20, step: 0.05, default: 1.2, hint: 'Steady-state gain change' },
      { key: 'tau', label: 'Time constant (τ)', unit: 's', min: 0.2, max: 120, step: 0.5, default: 15, hint: 'First-order dominant lag' },
      { key: 'theta', label: 'Dead time (θ)', unit: 's', min: 0, max: 40, step: 0.2, default: 3, hint: 'Pure transport delay' },
      { key: 'y0', label: 'Initial value', unit: '', min: -100, max: 100, step: 1, default: 0, hint: 'Initial process state' },
    ],
  },

  sopdt: {
    kind: 'sopdt',
    category: 'dynamics',
    name: 'SOPDT Plant',
    shortSymbol: 'K/[(τ₁s+1)(τ₂s+1)]',
    latex: (node) => {
      const { K = 1.0, tau1 = 12, tau2 = 5, theta = 2 } = node.params;
      return `G(s) = \\frac{${K}}{(${tau1}s + 1)(${tau2}s + 1)} e^{-${theta}s}`;
    },
    description: 'Second-Order Plus Dead Time (SOPDT) overdamped process model.',
    intuition: 'Represents dual capacitive thermal or level systems (e.g. jacket + reactor or two liquid tanks in series) exhibiting S-shaped inflection responses.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'K', label: 'Process gain (K)', unit: '%/%', min: -20, max: 20, step: 0.05, default: 1.0, hint: 'Steady-state gain' },
      { key: 'tau1', label: 'First lag (τ₁)', unit: 's', min: 0.2, max: 120, step: 0.5, default: 12, hint: 'Primary capacitive time constant' },
      { key: 'tau2', label: 'Second lag (τ₂)', unit: 's', min: 0.1, max: 60, step: 0.2, default: 5, hint: 'Secondary capacitive time constant' },
      { key: 'theta', label: 'Dead time (θ)', unit: 's', min: 0, max: 40, step: 0.2, default: 2, hint: 'Transport delay' },
    ],
  },

  deadtime: {
    kind: 'deadtime',
    category: 'dynamics',
    name: 'Pure Transport Delay',
    shortSymbol: 'e⁻θs',
    latex: (node) => {
      const { theta = 5 } = node.params;
      return `y(t) = u(t - ${theta}\\text{ s})`;
    },
    description: 'Pure time delay (transport lag) with unity magnitude gain and linear phase lag.',
    intuition: 'Simulates conveyor belts, pipeline fluid transport, and analyzer cycle times. Dead time erodes phase margin and is the primary cause of loop instability.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'theta', label: 'Delay time (θ)', unit: 's', min: 0.1, max: 60, step: 0.5, default: 5, hint: 'Transport delay duration' },
      { key: 'y0', label: 'Initial value', unit: '', min: -100, max: 100, step: 1, default: 0, hint: 'Output value before first delayed sample emerges' },
    ],
  },

  valve: {
    kind: 'valve',
    category: 'dynamics',
    name: 'Control Valve Actuator',
    shortSymbol: 'Valve',
    latex: (node) => {
      const { tau = 0.8, rateLimit = 50, deadband = 0, char = 0 } = node.params;
      const chStr = char === 1 ? '\\text{equal-\\%}' : '\\text{linear}';
      return `\\tau_v \\dot{v} + v = u,\\quad |\\dot{v}| \\le ${rateLimit}\\\\%/\\text{s},\\quad \\text{deadband}=${deadband}\\\\%`;
    },
    description: 'Real-world pneumatic/electric actuator with actuator lag, slew rate limiting, stiction deadband, and linear vs equal-% trim.',
    intuition: 'Slew rate limiting causes phase lag during large transients, while deadband causes hunting limit cycles around the setpoint.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'tau', label: 'Actuator lag (τ)', unit: 's', min: 0.05, max: 10, step: 0.05, default: 0.8, hint: 'Diaphragm pneumatic lag' },
      { key: 'rateLimit', label: 'Rate limit', unit: '%/s', min: 5, max: 200, step: 5, default: 50, hint: 'Maximum stem velocity limit' },
      { key: 'deadband', label: 'Deadband (stiction)', unit: '%', min: 0, max: 5, step: 0.1, default: 0, hint: 'Mechanical backlash and packing stiction' },
      { key: 'char', label: 'Trim characteristic', unit: '', min: 0, max: 1, step: 1, default: 0, hint: '0 = Linear trim, 1 = Equal-percentage trim' },
    ],
  },

  nonlin_tank: {
    kind: 'nonlin_tank',
    category: 'dynamics',
    name: 'Nonlinear Gravity Tank',
    shortSymbol: 'Tank',
    latex: (node) => {
      const { A = 2.0, Cv = 1.2 } = node.params;
      return `A \\frac{dh}{dt} = u_{\\text{in}} - C_v \\sqrt{\\max(0, h)},\\quad A=${A},\\, C_v=${Cv}`;
    },
    description: 'Liquid tank draining by gravity according to Torricelli square-root outflow.',
    intuition: 'Process gain and time constant vary continuously with liquid height h: as level rises, discharge increases and effective plant gain drops.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'A', label: 'Tank area (A)', unit: 'm²', min: 0.5, max: 10, step: 0.1, default: 2.0, hint: 'Cross-sectional area of vessel' },
      { key: 'Cv', label: 'Outflow coeff (Cv)', unit: '', min: 0.2, max: 5, step: 0.1, default: 1.2, hint: 'Gravity drain resistance factor' },
      { key: 'h0', label: 'Initial level (h0)', unit: 'm', min: 0, max: 10, step: 0.1, default: 1.0, hint: 'Liquid level at t=0' },
      { key: 'hMax', label: 'Max height', unit: 'm', min: 2, max: 20, step: 1, default: 10, hint: 'Tank overflow limit' },
    ],
  },

  sum: {
    kind: 'sum',
    category: 'math',
    name: 'Summing Junction',
    shortSymbol: 'Σ',
    latex: (node) => {
      const signs = (node.signs || '+-').split('');
      const terms = signs.map((s, i) => `${s === '-' ? '-' : '+'} u_{${i + 1}}(t)`).join(' ');
      return `y(t) = ${terms.replace(/^\\+\s*/, '')}`;
    },
    description: 'Sums or subtracts up to 3 dynamic signals according to configured sign pattern.',
    intuition: 'Fundamental summing block. Pattern "+ -" forms the classic setpoint error e = SP - PV; "+ +" adds feedforward or load disturbances.',
    inputs: ['+', '-'],
    outputs: ['out'],
    paramSpecs: [],
  },

  product: {
    kind: 'product',
    category: 'math',
    name: 'Multiplier',
    shortSymbol: 'Π',
    latex: () => 'y(t) = u_1(t) \\times u_2(t)',
    description: 'Instantaneous dynamic product of two input signals: y = u1 · u2.',
    intuition: 'Models cross-coupling interactions, heat transfer (Q = F · ΔT), and variable-gain process mechanisms.',
    inputs: ['in1', 'in2'],
    outputs: ['out'],
    paramSpecs: [],
  },

  saturation: {
    kind: 'saturation',
    category: 'math',
    name: 'Saturation Limiter',
    shortSymbol: '[lo,hi]',
    latex: (node) => {
      const { lo = 0, hi = 100 } = node.params;
      return `y(t) = \\min\\big(${hi},\\, \\max(${lo},\\, u(t))\\big)`;
    },
    description: 'Hard signal clipper clamping signals within upper and lower physical limits.',
    intuition: 'Emulates physical boundaries: 0–100% valve travel, maximum pump RPM, or electrical ADC voltage rails.',
    inputs: ['in'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'lo', label: 'Lower limit', unit: '', min: -200, max: 100, step: 1, default: 0, hint: 'Minimum allowable signal value' },
      { key: 'hi', label: 'Upper limit', unit: '', min: 0, max: 200, step: 1, default: 100, hint: 'Maximum allowable signal value' },
    ],
  },

  selector: {
    kind: 'selector',
    category: 'math',
    name: 'Override Selector',
    shortSymbol: 'MIN/MAX',
    latex: (node) => {
      const isMax = node.params.mode === 1;
      return `y(t) = \\operatorname{${isMax ? 'MAX' : 'MIN'}}\\big(u_1(t),\\, u_2(t)\\big)`;
    },
    description: 'High-select (MAX) or Low-select (MIN) override gating block.',
    intuition: 'Selects the safest control signal between normal throughput and safety override limits (e.g. low-select for high-pressure constraint protection).',
    inputs: ['in1', 'in2'],
    outputs: ['out'],
    paramSpecs: [
      { key: 'mode', label: 'Selection mode', unit: '', min: 0, max: 1, step: 1, default: 0, hint: '0 = MIN selector, 1 = MAX selector' },
    ],
  },

  scope: {
    kind: 'scope',
    category: 'sinks',
    name: 'Time Scope Probe',
    shortSymbol: 'Scope',
    latex: () => '\\text{Scope Probes: } [ch_1 = \\text{SP},\\, ch_2 = \\text{PV},\\, ch_3 = \\text{OP}]',
    description: '3-channel virtual oscilloscope displaying dynamic traces and automated performance analytics.',
    intuition: 'Time-domain probe. Connect SP to ch1, PV to ch2, and OP to ch3 to observe rise time, peak overshoot, and IAE performance in real time.',
    inputs: ['ch1', 'ch2', 'ch3'],
    outputs: [],
    paramSpecs: [],
  },

  xy: {
    kind: 'xy',
    category: 'sinks',
    name: 'X-Y Phase Trajectory',
    shortSymbol: 'X-Y',
    latex: () => '(x(t), y(t)) \\text{ Phase-Plane Trajectory}',
    description: '2-dimensional parametric trajectory plotter for phase plane and valve hysteresis analysis.',
    intuition: 'Plots one signal against another to expose limit cycles, state space orbits, and actuator hysteresis loops.',
    inputs: ['x', 'y'],
    outputs: [],
    paramSpecs: [],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getNodeInputPorts(node: BlockNode): string[] {
  if (node.kind === 'sum') {
    const signs = (node.signs || '+-').split('');
    return signs.map((s, i) => `${s} (in${i + 1})`);
  }
  return BLOCK_CATALOG[node.kind]?.inputs ?? ['in'];
}

export function getNodeOutputPorts(node: BlockNode): string[] {
  return BLOCK_CATALOG[node.kind]?.outputs ?? [];
}

// Deterministic PRNG for reproducible noise traces
function makePrng(seed: number) {
  let s = (Math.floor(seed) || 1) & 0xffffffff;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gaussianRandom(prng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = prng();
  while (v === 0) v = prng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─── Simulation Engine ───────────────────────────────────────────────────────

export function simulateBlockDiagram(model: BlockDiagramModel): BlockSimResult {
  const dt = Math.max(0.01, Math.min(1.0, Number(model.dt) || 0.1));
  const duration = Math.max(2, Math.min(300, Number(model.duration) || 60));
  const steps = Math.min(6000, Math.max(10, Math.round(duration / dt)));

  const t: number[] = new Array(steps);
  for (let i = 0; i < steps; i++) t[i] = Number((i * dt).toFixed(3));

  // Pre-allocate output arrays for each node
  const nodeOutputs: Record<string, number[]> = {};
  for (const node of model.nodes) {
    nodeOutputs[node.id] = new Array(steps).fill(0);
  }

  // Ring buffers for pure delays
  const deadtimeBuffers: Record<string, Float64Array> = {};
  for (const node of model.nodes) {
    if (node.kind === 'deadtime' || node.kind === 'fopdt' || node.kind === 'sopdt') {
      const theta = Math.max(0, Number(node.params.theta ?? (node.kind === 'deadtime' ? 5 : 0)));
      const bufLen = Math.max(1, Math.round(theta / dt) + 1);
      const buf = new Float64Array(bufLen);
      const initVal = Number(node.params.y0 ?? 0);
      buf.fill(initVal);
      deadtimeBuffers[node.id] = buf;
    }
  }
  const deadtimeIndices: Record<string, number> = {};
  for (const k in deadtimeBuffers) deadtimeIndices[k] = 0;

  // Dynamic state trackers
  type DynamicState = {
    // PID
    pidI: number;
    pidD: number;
    pidPrevE: number;
    // FOPDT
    fopdtY: number;
    // SOPDT
    sopdtX1: number;
    sopdtX2: number;
    // Lead-Lag
    leadlagX: number;
    // Integrator
    integratorY: number;
    // Derivative
    derivD: number;
    derivPrevU: number;
    // Valve
    valvePos: number;
    valveTarget: number;
    // Tank
    tankH: number;
    // Noise PRNG
    prng?: () => number;
  };

  const states: Record<string, DynamicState> = {};
  for (const node of model.nodes) {
    states[node.id] = {
      pidI: 0,
      pidD: 0,
      pidPrevE: 0,
      fopdtY: Number(node.params.y0 ?? 0),
      sopdtX1: Number(node.params.y0 ?? 0),
      sopdtX2: Number(node.params.y0 ?? 0),
      leadlagX: 0,
      integratorY: Number(node.params.y0 ?? 0),
      derivD: 0,
      derivPrevU: 0,
      valvePos: 0,
      valveTarget: 0,
      tankH: Math.max(0, Number(node.params.h0 ?? 1)),
      prng: node.kind === 'noise' ? makePrng(node.params.seed ?? 42) : undefined,
    };
  }

  // Pre-index wires: targetNodeId -> array of { fromBlock, fromPort, toPort }
  const incomingWires: Record<string, BlockWire[]> = {};
  for (const wire of model.wires) {
    if (!incomingWires[wire.toBlock]) incomingWires[wire.toBlock] = [];
    incomingWires[wire.toBlock].push(wire);
  }

  // Step loop
  const curOutputs: Record<string, number> = {};
  for (const node of model.nodes) curOutputs[node.id] = 0;

  for (let k = 0; k < steps; k++) {
    const curT = t[k];

    // Helper: read current input for block port
    const getInput = (blockId: string, portIndex: number, fallback = 0): number => {
      const wires = incomingWires[blockId];
      if (!wires || wires.length === 0) return fallback;
      let sum = 0;
      let connected = false;
      for (const w of wires) {
        if (w.toPort === portIndex) {
          sum += curOutputs[w.fromBlock] ?? 0;
          connected = true;
        }
      }
      return connected ? sum : fallback;
    };

    // 1. Evaluate Sources (depend strictly on time)
    for (const node of model.nodes) {
      const p = node.params;
      let val = 0;
      switch (node.kind) {
        case 'step': {
          const y0 = p.y0 ?? 0;
          const y1 = p.y1 ?? 10;
          const tStep = p.tStep ?? 2;
          val = curT < tStep ? y0 : y1;
          break;
        }
        case 'ramp': {
          const slope = p.slope ?? 1;
          const tStart = p.tStart ?? 2;
          const y0 = p.y0 ?? 0;
          val = y0 + slope * Math.max(0, curT - tStart);
          break;
        }
        case 'sine': {
          const amp = p.amp ?? 5;
          const freq = p.freq ?? 0.5;
          const bias = p.bias ?? 0;
          val = bias + amp * Math.sin(freq * curT);
          break;
        }
        case 'pulse': {
          const amp = p.amp ?? 10;
          const period = Math.max(0.1, p.period ?? 20);
          const duty = Math.max(0, Math.min(100, p.duty ?? 50));
          const tMod = curT % period;
          val = tMod < (period * duty) / 100 ? amp : 0;
          break;
        }
        case 'noise': {
          const std = p.std ?? 0.5;
          const prng = states[node.id].prng || Math.random;
          val = gaussianRandom(prng) * std;
          break;
        }
        case 'constant': {
          val = p.value ?? 50;
          break;
        }
      }
      if (BLOCK_CATALOG[node.kind]?.category === 'sources') curOutputs[node.id] = val;
    }

    // 2. Continuous dynamic blocks produce their current output state
    for (const node of model.nodes) {
      const st = states[node.id];
      switch (node.kind) {
        case 'fopdt':
          curOutputs[node.id] = st.fopdtY;
          break;
        case 'sopdt':
          curOutputs[node.id] = st.sopdtX2;
          break;
        case 'integrator':
          curOutputs[node.id] = st.integratorY;
          break;
        case 'nonlin_tank':
          curOutputs[node.id] = st.tankH;
          break;
        case 'deadtime': {
          const buf = deadtimeBuffers[node.id];
          if (buf && buf.length > 0) {
            const idx = deadtimeIndices[node.id] % buf.length;
            curOutputs[node.id] = buf[idx];
          } else {
            curOutputs[node.id] = Number(node.params.y0 ?? 0);
          }
          break;
        }
        case 'valve': {
          const p = node.params;
          const char = p.char ?? 0;
          const v = st.valvePos;
          if (char === 1) {
            // Equal percentage characteristic (R = 50)
            const R = 50;
            const norm = Math.max(0, Math.min(100, v)) / 100;
            curOutputs[node.id] = (Math.pow(R, norm - 1) - 1 / R) / (1 - 1 / R) * 100;
          } else {
            curOutputs[node.id] = v;
          }
          break;
        }
      }
    }

    // 3. Algebraic / Controller relaxation passes (2 iterations settle instantaneous feedforward chains)
    for (let pass = 0; pass < 2; pass++) {
      for (const node of model.nodes) {
        const p = node.params;
        const st = states[node.id];

        switch (node.kind) {
          case 'sum': {
            const signs = (node.signs || '+-').split('');
            let sum = 0;
            for (let i = 0; i < signs.length; i++) {
              const u = getInput(node.id, i, 0);
              sum += (signs[i] === '-' ? -1 : 1) * u;
            }
            curOutputs[node.id] = sum;
            break;
          }

          case 'gain': {
            const K = p.K ?? 1.5;
            curOutputs[node.id] = K * getInput(node.id, 0, 0);
            break;
          }

          case 'product': {
            const u1 = getInput(node.id, 0, 0);
            const u2 = getInput(node.id, 1, 0);
            curOutputs[node.id] = u1 * u2;
            break;
          }

          case 'saturation': {
            const lo = p.lo ?? 0;
            const hi = p.hi ?? 100;
            const u = getInput(node.id, 0, 0);
            curOutputs[node.id] = Math.max(lo, Math.min(hi, u));
            break;
          }

          case 'selector': {
            const mode = p.mode ?? 0;
            const u1 = getInput(node.id, 0, 0);
            const u2 = getInput(node.id, 1, 0);
            curOutputs[node.id] = mode === 1 ? Math.max(u1, u2) : Math.min(u1, u2);
            break;
          }

          case 'pid': {
            const Kc = p.Kc ?? 2.0;
            const Ti = p.Ti ?? 12;
            const Td = p.Td ?? 0;
            const N = Math.max(1, p.N ?? 10);
            const uMin = p.uMin ?? -100;
            const uMax = p.uMax ?? 100;
            const bias = p.bias ?? 0;

            const e = getInput(node.id, 0, 0);
            const P = Kc * e;

            // Proportional + Integral + Derivative
            const uRaw = bias + P + st.pidI + st.pidD;
            curOutputs[node.id] = Math.max(uMin, Math.min(uMax, uRaw));
            break;
          }

          case 'leadlag': {
            const K = p.K ?? 1.0;
            const Tlead = p.Tlead ?? 8;
            const Tlag = Math.max(0.01, p.Tlag ?? 15);
            const u = getInput(node.id, 0, 0);
            const ratio = Tlead / Tlag;
            curOutputs[node.id] = K * (ratio * u + (1 - ratio) * st.leadlagX);
            break;
          }

          case 'derivative': {
            curOutputs[node.id] = st.derivD;
            break;
          }
        }
      }
    }

    // 4. Advance dynamic states with dt using exact exponential / RK4 discretizations
    for (const node of model.nodes) {
      const p = node.params;
      const st = states[node.id];
      const inVal = getInput(node.id, 0, 0);

      switch (node.kind) {
        case 'fopdt': {
          const K = p.K ?? 1.2;
          const tau = Math.max(0.01, p.tau ?? 15);
          // Retrieve delayed input from ring buffer
          let uDelayed = inVal;
          const buf = deadtimeBuffers[node.id];
          if (buf && buf.length > 0) {
            const theta = Math.max(0, p.theta ?? 0);
            const delaySteps = Math.min(buf.length - 1, Math.round(theta / dt));
            const readIdx = (deadtimeIndices[node.id] - delaySteps + buf.length) % buf.length;
            uDelayed = buf[readIdx];
            buf[deadtimeIndices[node.id] % buf.length] = inVal;
            deadtimeIndices[node.id]++;
          }
          const alpha = Math.exp(-dt / tau);
          st.fopdtY = alpha * st.fopdtY + (1 - alpha) * K * uDelayed;
          break;
        }

        case 'sopdt': {
          const K = p.K ?? 1.0;
          const tau1 = Math.max(0.01, p.tau1 ?? 12);
          const tau2 = Math.max(0.01, p.tau2 ?? 5);
          let uDelayed = inVal;
          const buf = deadtimeBuffers[node.id];
          if (buf && buf.length > 0) {
            const theta = Math.max(0, p.theta ?? 0);
            const delaySteps = Math.min(buf.length - 1, Math.round(theta / dt));
            const readIdx = (deadtimeIndices[node.id] - delaySteps + buf.length) % buf.length;
            uDelayed = buf[readIdx];
            buf[deadtimeIndices[node.id] % buf.length] = inVal;
            deadtimeIndices[node.id]++;
          }
          const a1 = Math.exp(-dt / tau1);
          const a2 = Math.exp(-dt / tau2);
          st.sopdtX1 = a1 * st.sopdtX1 + (1 - a1) * K * uDelayed;
          st.sopdtX2 = a2 * st.sopdtX2 + (1 - a2) * st.sopdtX1;
          break;
        }

        case 'deadtime': {
          const buf = deadtimeBuffers[node.id];
          if (buf && buf.length > 0) {
            buf[deadtimeIndices[node.id] % buf.length] = inVal;
            deadtimeIndices[node.id]++;
          }
          break;
        }

        case 'integrator': {
          const K = p.K ?? 0.2;
          const lo = p.min ?? -100;
          const hi = p.max ?? 100;
          st.integratorY = Math.max(lo, Math.min(hi, st.integratorY + K * inVal * dt));
          break;
        }

        case 'valve': {
          const tau = Math.max(0.01, p.tau ?? 0.8);
          const rateLimit = Math.max(1, p.rateLimit ?? 50);
          const deadband = Math.max(0, p.deadband ?? 0);

          // Stiction / Deadband logic
          if (Math.abs(inVal - st.valveTarget) > deadband / 2) {
            st.valveTarget = inVal - Math.sign(inVal - st.valveTarget) * (deadband / 2);
          }

          // Rate limit & actuator lag
          const maxDelta = rateLimit * dt;
          const rawDelta = st.valveTarget - st.valvePos;
          const rateLimitedTarget = st.valvePos + Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
          const alpha = dt / (tau + dt);
          st.valvePos += alpha * (rateLimitedTarget - st.valvePos);
          break;
        }

        case 'nonlin_tank': {
          const A = Math.max(0.1, p.A ?? 2.0);
          const Cv = Math.max(0.01, p.Cv ?? 1.2);
          const hMax = p.hMax ?? 10;
          // Runge-Kutta 4th order integration
          const f = (h: number) => (inVal - Cv * Math.sqrt(Math.max(0, h))) / A;
          const k1 = f(st.tankH);
          const k2 = f(st.tankH + 0.5 * dt * k1);
          const k3 = f(st.tankH + 0.5 * dt * k2);
          const k4 = f(st.tankH + dt * k3);
          st.tankH = Math.max(0, Math.min(hMax, st.tankH + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)));
          break;
        }

        case 'pid': {
          const Kc = p.Kc ?? 2.0;
          const Ti = p.Ti ?? 12;
          const Td = p.Td ?? 0;
          const N = Math.max(1, p.N ?? 10);
          const uMin = p.uMin ?? -100;
          const uMax = p.uMax ?? 100;
          const bias = p.bias ?? 0;

          const e = inVal;

          // Anti-windup integral update
          if (Ti > 0) {
            const rawU = bias + Kc * e + st.pidI + st.pidD;
            const saturatingHigh = rawU >= uMax && e > 0;
            const saturatingLow = rawU <= uMin && e < 0;
            if (!saturatingHigh && !saturatingLow) {
              st.pidI += (Kc / Ti) * e * dt;
              st.pidI = Math.max(uMin - bias, Math.min(uMax - bias, st.pidI));
            }
          }

          // Derivative filter update: D(s) = (Kc * Td * s) / (1 + Td/N * s) * E(s)
          if (Td > 0) {
            const tauF = Math.max(1e-4, Td / N);
            const aD = tauF / (tauF + dt);
            const deltaE = k === 0 ? 0 : e - st.pidPrevE;
            st.pidD = aD * st.pidD + (Kc * Td / (tauF + dt)) * deltaE;
          } else {
            st.pidD = 0;
          }
          st.pidPrevE = e;
          break;
        }

        case 'leadlag': {
          const Tlag = Math.max(0.01, p.Tlag ?? 15);
          const a = Math.exp(-dt / Tlag);
          st.leadlagX = a * st.leadlagX + (1 - a) * inVal;
          break;
        }

        case 'derivative': {
          const Td = p.Td ?? 2.0;
          const alpha = Math.max(0.01, p.alpha ?? 0.1);
          const tauF = Math.max(1e-4, alpha * Td);
          const a = tauF / (tauF + dt);
          const deltaU = k === 0 ? 0 : inVal - st.derivPrevU;
          st.derivD = a * st.derivD + (Td / (tauF + dt)) * deltaU;
          st.derivPrevU = inVal;
          break;
        }
      }
    }

    // 5. Store sanitized step values into nodeOutputs
    for (const node of model.nodes) {
      let v = curOutputs[node.id];
      if (!Number.isFinite(v)) v = 0;
      else if (v > 1e6) v = 1e6;
      else if (v < -1e6) v = -1e6;
      nodeOutputs[node.id][k] = v;
    }
  }

  // ─── Extract Scope & XY Series ─────────────────────────────────────────────

  const scopeSeries: BlockSimResult['scopeSeries'] = [];
  const xyPlots: BlockSimResult['xyPlots'] = [];

  const defaultScopeColors = ['#93c5fd', '#10b981', '#f59e0b']; // ch1: SP (light blue), ch2: PV (emerald), ch3: OP (amber)
  const defaultScopeLabels = ['Setpoint (ch1)', 'Process Value (ch2)', 'Controller / Actuator (ch3)'];

  for (const node of model.nodes) {
    if (node.kind === 'scope') {
      const wires = incomingWires[node.id] || [];
      const seriesList: { label: string; color: string; x: number[]; y: number[] }[] = [];
      const metricsList: ScopeMetrics[] = [];

      for (let ch = 0; ch < 3; ch++) {
        const wire = wires.find((w) => w.toPort === ch);
        if (!wire) continue;

        const srcNode = model.nodes.find((n) => n.id === wire.fromBlock);
        const yVals = nodeOutputs[wire.fromBlock] || new Array(steps).fill(0);
        const label = wire.label || (srcNode ? `${srcNode.label} (${defaultScopeLabels[ch].split(' ')[0]})` : defaultScopeLabels[ch]);
        const color = defaultScopeColors[ch];

        seriesList.push({
          label,
          color,
          x: t,
          y: yVals,
        });

        // Compute metrics
        const finalVal = yVals[steps - 1] ?? 0;
        let peak = -Infinity;
        let min = Infinity;
        let iae = 0;

        // If ch1 exists in this scope and this is ch2 (PV), compute tracking IAE against ch1
        const ch1Wire = wires.find((w) => w.toPort === 0);
        const ch1Vals = ch1Wire ? nodeOutputs[ch1Wire.fromBlock] : null;

        for (let i = 0; i < steps; i++) {
          const v = yVals[i];
          if (v > peak) peak = v;
          if (v < min) min = v;
          if (ch === 1 && ch1Vals) {
            iae += Math.abs(ch1Vals[i] - v) * dt;
          } else {
            iae += Math.abs(v - finalVal) * dt;
          }
        }

        const delta = finalVal - (yVals[0] ?? 0);
        let overshootPct = 0;
        if (Math.abs(delta) > 1e-4) {
          if (delta > 0) {
            overshootPct = Math.max(0, ((peak - finalVal) / delta) * 100);
          } else {
            overshootPct = Math.max(0, ((finalVal - min) / Math.abs(delta)) * 100);
          }
        }

        // Settling time: within ±2% of delta (or ±0.05 absolute)
        const tol = Math.max(0.02 * Math.abs(delta), 0.05);
        let settleTime: number | null = null;
        for (let i = steps - 1; i >= 0; i--) {
          if (Math.abs(yVals[i] - finalVal) > tol) {
            if (i < steps - 1) settleTime = t[i + 1];
            break;
          }
        }

        metricsList.push({
          label,
          color,
          finalValue: Number(finalVal.toFixed(2)),
          peak: Number(peak.toFixed(2)),
          min: Number(min.toFixed(2)),
          overshootPct: Number(overshootPct.toFixed(1)),
          settleTime: settleTime !== null ? Number(settleTime.toFixed(1)) : null,
          iae: Number(iae.toFixed(1)),
        });
      }

      scopeSeries.push({
        id: node.id,
        title: node.label || 'Oscilloscope Probe',
        series: seriesList,
        metrics: metricsList,
      });
    }

    if (node.kind === 'xy') {
      const wires = incomingWires[node.id] || [];
      const wireX = wires.find((w) => w.toPort === 0);
      const wireY = wires.find((w) => w.toPort === 1);

      const srcNodeX = wireX ? model.nodes.find((n) => n.id === wireX.fromBlock) : null;
      const srcNodeY = wireY ? model.nodes.find((n) => n.id === wireY.fromBlock) : null;

      const xData = wireX ? nodeOutputs[wireX.fromBlock] : new Array(steps).fill(0);
      const yData = wireY ? nodeOutputs[wireY.fromBlock] : new Array(steps).fill(0);

      xyPlots.push({
        id: node.id,
        title: node.label || 'Phase Trajectory (X-Y)',
        x: xData,
        y: yData,
        xLabel: srcNodeX ? srcNodeX.label : 'X Signal',
        yLabel: srcNodeY ? srcNodeY.label : 'Y Signal',
      });
    }
  }

  // ─── Diagram Architecture Summary ──────────────────────────────────────────

  let effectiveK = 1.0;
  let effectiveTau1 = 15.0;
  let effectiveTau2 = 0.0;
  let effectiveTheta = 0.0;
  let integrating = false;

  const fopdtNode = model.nodes.find((n) => n.kind === 'fopdt');
  const sopdtNode = model.nodes.find((n) => n.kind === 'sopdt');
  const integratorNode = model.nodes.find((n) => n.kind === 'integrator');
  const deadtimeNode = model.nodes.find((n) => n.kind === 'deadtime');

  if (integratorNode) {
    integrating = true;
    effectiveK = integratorNode.params.K ?? 0.2;
    effectiveTau1 = 1.0;
  } else if (sopdtNode) {
    effectiveK = sopdtNode.params.K ?? 1.0;
    effectiveTau1 = sopdtNode.params.tau1 ?? 12.0;
    effectiveTau2 = sopdtNode.params.tau2 ?? 5.0;
    effectiveTheta += sopdtNode.params.theta ?? 2.0;
  } else if (fopdtNode) {
    effectiveK = fopdtNode.params.K ?? 1.2;
    effectiveTau1 = fopdtNode.params.tau ?? 15.0;
    effectiveTheta += fopdtNode.params.theta ?? 3.0;
  }

  if (deadtimeNode) {
    effectiveTheta += deadtimeNode.params.theta ?? 5.0;
  }

  const pidNode = model.nodes.find((n) => n.kind === 'pid');
  const controllerKc = pidNode ? pidNode.params.Kc ?? 2.0 : 1.0;
  const controllerTi = pidNode ? pidNode.params.Ti ?? 12.0 : 10.0;
  const controllerTd = pidNode ? pidNode.params.Td ?? 0.0 : 0.0;

  // Check if feedback loop is closed
  let loopClosed = false;
  for (const wire of model.wires) {
    const toNode = model.nodes.find((n) => n.id === wire.toBlock);
    const fromNode = model.nodes.find((n) => n.id === wire.fromBlock);
    if (
      toNode?.kind === 'sum' &&
      (BLOCK_CATALOG[fromNode?.kind || 'step']?.category === 'dynamics' ||
        fromNode?.kind === 'scope' ||
        wire.label?.toLowerCase().includes('fb') ||
        wire.label?.toLowerCase().includes('pred') ||
        wire.label?.toLowerCase().includes('feedback'))
    ) {
      loopClosed = true;
      break;
    }
  }

  return {
    t,
    nodeOutputs,
    scopeSeries,
    xyPlots,
    summary: {
      effectiveK: Number(effectiveK.toFixed(2)),
      effectiveTau1: Number(effectiveTau1.toFixed(1)),
      effectiveTau2: Number(effectiveTau2.toFixed(1)),
      effectiveTheta: Number(effectiveTheta.toFixed(1)),
      integrating,
      controllerKc: Number(controllerKc.toFixed(2)),
      controllerTi: Number(controllerTi.toFixed(1)),
      controllerTd: Number(controllerTd.toFixed(2)),
      loopClosed,
    },
  };
}

// ─── Bench Export ────────────────────────────────────────────────────────────

export function exportToBenchUrl(model: BlockDiagramModel): string {
  const res = simulateBlockDiagram(model);
  const { summary } = res;

  const K = Math.max(-50, Math.min(50, summary.effectiveK || 1.0));
  const tau1 = Math.max(0.1, Math.min(1000, summary.effectiveTau1 || 15.0));
  const tau2 = Math.max(0, Math.min(1000, summary.effectiveTau2 || 0.0));
  const txDelay = Math.max(0, Math.min(100, summary.effectiveTheta || 2.0));
  const integrating = summary.integrating ? 1 : 0;

  const customParams = {
    integrating,
    K,
    tau1,
    tau2,
    bias: 0,
    u0: 50,
    txDelay,
    txNoise: 0.2,
    Ts: 0.5,
    valveTau: 0.1,
    valveRate: 1000,
    valveChar: 0,
    txTau: 0.1,
  };

  const pidParams: PidParams = {
    ...DEFAULT_PID,
    Kc: Math.max(0.01, Math.min(50, summary.controllerKc || 1.8)),
    Ti: Math.max(0, Math.min(500, summary.controllerTi || 14.0)),
    Td: Math.max(0, Math.min(100, summary.controllerTd || 0.0)),
  };

  type BenchmarkController =
    | { kind: 'pid'; pid: PidParams }
    | { kind: 'cascade'; outer: PidParams; inner: PidParams; ff: [] }
    | { kind: 'smith'; pid: PidParams; model: { K: number; tau: number; theta: number } };

  let controller: BenchmarkController;
  if (model.id === 'cascade-loop' || model.name.toLowerCase().includes('cascade')) {
    controller = {
      kind: 'cascade',
      outer: pidParams,
      inner: { ...DEFAULT_PID, Kc: 2.2, Ti: 4, Td: 0 },
      ff: [],
    };
  } else if (model.id === 'smith-predictor' || model.name.toLowerCase().includes('smith')) {
    controller = {
      kind: 'smith',
      pid: pidParams,
      model: { K, tau: tau1, theta: txDelay },
    };
  } else {
    controller = {
      kind: 'pid',
      pid: pidParams,
    };
  }

  const experiment: Experiment = {
    process: 'custom',
    params: customParams as any,
    controller: controller as any,
  };

  return `/loop-lab/bench?setup=${encodeExperiment(experiment)}#tests`;
}

// ─── 5 Pre-Built System Templates ───────────────────────────────────────────

export const BLOCK_TEMPLATES: BlockDiagramModel[] = [
  {
    id: 'fopdt-pid',
    name: 'Standard PID Feedback Loop (FOPDT + Saturation)',
    description: 'Classic negative feedback loop with a PID controller, output saturation limiter, and FOPDT plant.',
    duration: 80,
    dt: 0.1,
    nodes: [
      { id: 'ref', kind: 'step', label: 'Setpoint SP', x: 25, y: 135, params: { y0: 0, y1: 10, tStep: 2 } },
      { id: 'sum', kind: 'sum', label: 'Error Junction', x: 245, y: 135, signs: '+-', params: {} },
      { id: 'pid', kind: 'pid', label: 'PID Controller', x: 465, y: 135, params: { Kc: 1.8, Ti: 14, Td: 0, N: 10, uMin: -100, uMax: 100, bias: 0 } },
      { id: 'sat', kind: 'saturation', label: 'Actuator Limits', x: 685, y: 135, params: { lo: -100, hi: 100 } },
      { id: 'plant', kind: 'fopdt', label: 'FOPDT Plant', x: 905, y: 135, params: { K: 1.2, tau: 15, theta: 3, y0: 0 } },
      { id: 'scope', kind: 'scope', label: 'Loop Scope', x: 1125, y: 135, params: {} },
    ],
    wires: [
      { id: 'w1', fromBlock: 'ref', fromPort: 0, toBlock: 'sum', toPort: 0 },
      { id: 'w2', fromBlock: 'sum', fromPort: 0, toBlock: 'pid', toPort: 0 },
      { id: 'w3', fromBlock: 'pid', fromPort: 0, toBlock: 'sat', toPort: 0 },
      { id: 'w4', fromBlock: 'sat', fromPort: 0, toBlock: 'plant', toPort: 0 },
      { id: 'w5', fromBlock: 'plant', fromPort: 0, toBlock: 'sum', toPort: 1, label: 'Feedback' },
      { id: 'w6', fromBlock: 'ref', fromPort: 0, toBlock: 'scope', toPort: 0, label: 'SP' },
      { id: 'w7', fromBlock: 'plant', fromPort: 0, toBlock: 'scope', toPort: 1, label: 'PV' },
      { id: 'w8', fromBlock: 'sat', fromPort: 0, toBlock: 'scope', toPort: 2, label: 'OP' },
    ],
  },

  {
    id: 'cascade-loop',
    name: 'Cascade Control Loop (Master Temp + Slave Flow)',
    description: 'Master controller adjusts the setpoint of a fast inner slave loop to reject disturbances before they affect the primary process.',
    duration: 80,
    dt: 0.1,
    nodes: [
      { id: 'ref', kind: 'step', label: 'Master SP', x: 25, y: 135, params: { y0: 0, y1: 20, tStep: 2 } },
      { id: 'sum1', kind: 'sum', label: 'Outer Error', x: 235, y: 135, signs: '+-', params: {} },
      { id: 'pid1', kind: 'pid', label: 'Master PID', x: 445, y: 135, params: { Kc: 1.5, Ti: 25, Td: 0, N: 10, uMin: 0, uMax: 100, bias: 0 } },
      { id: 'sum2', kind: 'sum', label: 'Inner Error', x: 665, y: 135, signs: '+-', params: {} },
      { id: 'pid2', kind: 'pid', label: 'Slave PID', x: 875, y: 135, params: { Kc: 2.2, Ti: 4, Td: 0, N: 10, uMin: 0, uMax: 100, bias: 0 } },
      { id: 'inner', kind: 'fopdt', label: 'Inner Plant (Fast)', x: 1085, y: 135, params: { K: 1.0, tau: 2.5, theta: 0.3, y0: 0 } },
      { id: 'outer', kind: 'fopdt', label: 'Outer Plant (Slow)', x: 1305, y: 135, params: { K: 1.1, tau: 20, theta: 2.0, y0: 0 } },
      { id: 'scope', kind: 'scope', label: 'Cascade Scope', x: 1525, y: 135, params: {} },
    ],
    wires: [
      { id: 'cw1', fromBlock: 'ref', fromPort: 0, toBlock: 'sum1', toPort: 0 },
      { id: 'cw2', fromBlock: 'sum1', fromPort: 0, toBlock: 'pid1', toPort: 0 },
      { id: 'cw3', fromBlock: 'pid1', fromPort: 0, toBlock: 'sum2', toPort: 0, label: 'Slave SP' },
      { id: 'cw4', fromBlock: 'sum2', fromPort: 0, toBlock: 'pid2', toPort: 0 },
      { id: 'cw5', fromBlock: 'pid2', fromPort: 0, toBlock: 'inner', toPort: 0 },
      { id: 'cw6', fromBlock: 'inner', fromPort: 0, toBlock: 'outer', toPort: 0 },
      { id: 'cw7', fromBlock: 'inner', fromPort: 0, toBlock: 'sum2', toPort: 1, label: 'Inner FB' },
      { id: 'cw8', fromBlock: 'outer', fromPort: 0, toBlock: 'sum1', toPort: 1, label: 'Outer FB' },
      { id: 'cw9', fromBlock: 'ref', fromPort: 0, toBlock: 'scope', toPort: 0, label: 'Outer SP' },
      { id: 'cw10', fromBlock: 'outer', fromPort: 0, toBlock: 'scope', toPort: 1, label: 'Outer PV' },
      { id: 'cw11', fromBlock: 'inner', fromPort: 0, toBlock: 'scope', toPort: 2, label: 'Inner PV' },
    ],
  },

  {
    id: 'feedforward-disturbance',
    name: 'Feedforward + Feedback Disturbance Rejection',
    description: 'Measured load disturbance is dynamically compensated via lead-lag network in parallel with feedback PID.',
    duration: 70,
    dt: 0.1,
    nodes: [
      { id: 'ref', kind: 'step', label: 'Setpoint SP', x: 25, y: 90, params: { y0: 0, y1: 10, tStep: 2 } },
      { id: 'sum_err', kind: 'sum', label: 'Feedback Error', x: 245, y: 90, signs: '+-', params: {} },
      { id: 'pid', kind: 'pid', label: 'Feedback PID', x: 465, y: 90, params: { Kc: 1.6, Ti: 16, Td: 0, N: 10, uMin: -100, uMax: 100, bias: 0 } },
      { id: 'dist', kind: 'step', label: 'Disturbance D', x: 25, y: 235, params: { y0: 0, y1: 5, tStep: 25 } },
      { id: 'ff', kind: 'leadlag', label: 'FF Lead-Lag', x: 465, y: 235, params: { K: -0.8, Tlead: 10, Tlag: 15 } },
      { id: 'sum_u', kind: 'sum', label: 'FF + FB Sum', x: 685, y: 150, signs: '++', params: {} },
      { id: 'sum_d', kind: 'sum', label: 'Disturbance Sum', x: 905, y: 150, signs: '++', params: {} },
      { id: 'plant', kind: 'fopdt', label: 'Process Plant', x: 1125, y: 150, params: { K: 1.2, tau: 15, theta: 2.5, y0: 0 } },
      { id: 'scope', kind: 'scope', label: 'FF/FB Scope', x: 1345, y: 150, params: {} },
    ],
    wires: [
      { id: 'fw1', fromBlock: 'ref', fromPort: 0, toBlock: 'sum_err', toPort: 0 },
      { id: 'fw3', fromBlock: 'sum_err', fromPort: 0, toBlock: 'pid', toPort: 0 },
      { id: 'fw2', fromBlock: 'dist', fromPort: 0, toBlock: 'ff', toPort: 0 },
      { id: 'fw4', fromBlock: 'pid', fromPort: 0, toBlock: 'sum_u', toPort: 0, label: 'FB OP' },
      { id: 'fw5', fromBlock: 'ff', fromPort: 0, toBlock: 'sum_u', toPort: 1, label: 'FF OP' },
      { id: 'fw6', fromBlock: 'sum_u', fromPort: 0, toBlock: 'sum_d', toPort: 0 },
      { id: 'fw7', fromBlock: 'dist', fromPort: 0, toBlock: 'sum_d', toPort: 1, label: 'Disturbance' },
      { id: 'fw8', fromBlock: 'sum_d', fromPort: 0, toBlock: 'plant', toPort: 0 },
      { id: 'fw9', fromBlock: 'plant', fromPort: 0, toBlock: 'sum_err', toPort: 1, label: 'Feedback' },
      { id: 'fw10', fromBlock: 'ref', fromPort: 0, toBlock: 'scope', toPort: 0, label: 'SP' },
      { id: 'fw11', fromBlock: 'plant', fromPort: 0, toBlock: 'scope', toPort: 1, label: 'PV' },
      { id: 'fw12', fromBlock: 'sum_u', fromPort: 0, toBlock: 'scope', toPort: 2, label: 'Total OP' },
    ],
  },

  {
    id: 'smith-predictor',
    name: 'Smith Predictor (Dead-Time Compensation)',
    description: 'Internal delay-free process model eliminates dead time from the feedback loop, allowing tight controller tuning on long dead-time processes.',
    duration: 80,
    dt: 0.1,
    nodes: [
      { id: 'ref', kind: 'step', label: 'Setpoint SP', x: 25, y: 90, params: { y0: 0, y1: 10, tStep: 2 } },
      { id: 'sum_main', kind: 'sum', label: 'Primary Error', x: 245, y: 90, signs: '+-', params: {} },
      { id: 'pid', kind: 'pid', label: 'Aggressive PI', x: 465, y: 90, params: { Kc: 2.5, Ti: 8, Td: 0, N: 10, uMin: -100, uMax: 100, bias: 0 } },
      { id: 'plant', kind: 'fopdt', label: 'Real Delayed Plant', x: 685, y: 75, params: { K: 1.0, tau: 10, theta: 12, y0: 0 } },
      { id: 'scope', kind: 'scope', label: 'Smith Scope', x: 1125, y: 75, params: {} },
      { id: 'model_lag', kind: 'fopdt', label: 'Internal Fast Model', x: 685, y: 235, params: { K: 1.0, tau: 10, theta: 0, y0: 0 } },
      { id: 'model_delay', kind: 'deadtime', label: 'Model Dead Time', x: 905, y: 235, params: { theta: 12, y0: 0 } },
      { id: 'sum_fb', kind: 'sum', label: 'Mismatch Sum', x: 1125, y: 215, signs: '+-', params: {} },
      { id: 'sum_pred', kind: 'sum', label: 'Predicted PV Sum', x: 1345, y: 235, signs: '++', params: {} },
    ],
    wires: [
      { id: 'sw1', fromBlock: 'ref', fromPort: 0, toBlock: 'sum_main', toPort: 0 },
      { id: 'sw2', fromBlock: 'sum_main', fromPort: 0, toBlock: 'pid', toPort: 0 },
      { id: 'sw3', fromBlock: 'pid', fromPort: 0, toBlock: 'plant', toPort: 0 },
      { id: 'sw4', fromBlock: 'pid', fromPort: 0, toBlock: 'model_lag', toPort: 0 },
      { id: 'sw5', fromBlock: 'model_lag', fromPort: 0, toBlock: 'model_delay', toPort: 0 },
      { id: 'sw6', fromBlock: 'plant', fromPort: 0, toBlock: 'sum_fb', toPort: 0, label: 'Plant y' },
      { id: 'sw7', fromBlock: 'model_delay', fromPort: 0, toBlock: 'sum_fb', toPort: 1, label: 'Model y' },
      { id: 'sw9', fromBlock: 'sum_fb', fromPort: 0, toBlock: 'sum_pred', toPort: 0, label: 'Mismatch' },
      { id: 'sw8', fromBlock: 'model_lag', fromPort: 0, toBlock: 'sum_pred', toPort: 1, label: 'Fast y' },
      { id: 'sw10', fromBlock: 'sum_pred', fromPort: 0, toBlock: 'sum_main', toPort: 1, label: 'Predicted FB' },
      { id: 'sw11', fromBlock: 'ref', fromPort: 0, toBlock: 'scope', toPort: 0, label: 'SP' },
      { id: 'sw12', fromBlock: 'plant', fromPort: 0, toBlock: 'scope', toPort: 1, label: 'Plant PV' },
      { id: 'sw13', fromBlock: 'pid', fromPort: 0, toBlock: 'scope', toPort: 2, label: 'OP' },
    ],
  },

  {
    id: 'custom-plant',
    name: '2nd-Order Dynamics + Transport Delay Loop',
    description: 'Second-order under/overdamped plant with pure transport lag in feedback configuration.',
    duration: 60,
    dt: 0.1,
    nodes: [
      { id: 'step', kind: 'step', label: 'Setpoint Step', x: 25, y: 135, params: { y0: 0, y1: 10, tStep: 2 } },
      { id: 'sum', kind: 'sum', label: 'Error Junction', x: 245, y: 135, signs: '+-', params: {} },
      { id: 'gain', kind: 'gain', label: 'Gain Compensator', x: 465, y: 135, params: { K: 2.0 } },
      { id: 'soc', kind: 'sopdt', label: '2nd-Order Dynamics', x: 685, y: 135, params: { K: 1.0, tau1: 12, tau2: 5, theta: 0, y0: 0 } },
      { id: 'delay', kind: 'deadtime', label: 'Transport Delay', x: 905, y: 135, params: { theta: 4, y0: 0 } },
      { id: 'scope', kind: 'scope', label: 'Loop Scope', x: 1125, y: 135, params: {} },
    ],
    wires: [
      { id: 'cpw1', fromBlock: 'step', fromPort: 0, toBlock: 'sum', toPort: 0 },
      { id: 'cpw2', fromBlock: 'sum', fromPort: 0, toBlock: 'gain', toPort: 0 },
      { id: 'cpw3', fromBlock: 'gain', fromPort: 0, toBlock: 'soc', toPort: 0 },
      { id: 'cpw4', fromBlock: 'soc', fromPort: 0, toBlock: 'delay', toPort: 0 },
      { id: 'cpw5', fromBlock: 'delay', fromPort: 0, toBlock: 'sum', toPort: 1, label: 'Feedback' },
      { id: 'cpw6', fromBlock: 'step', fromPort: 0, toBlock: 'scope', toPort: 0, label: 'SP' },
      { id: 'cpw7', fromBlock: 'delay', fromPort: 0, toBlock: 'scope', toPort: 1, label: 'PV' },
      { id: 'cpw8', fromBlock: 'gain', fromPort: 0, toBlock: 'scope', toPort: 2, label: 'OP' },
    ],
  },
];
