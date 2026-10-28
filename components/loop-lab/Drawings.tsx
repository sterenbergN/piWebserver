'use client';

import type { ControllerConfig } from '@/lib/loop-lab/controllers';
import { findCharacterization } from '@/lib/loop-lab/controllers';
import type { Params, ProcessDef } from '@/lib/loop-lab/model';
import { tankRadius } from '@/lib/loop-lab/processes/tank';

// Drawings for the three views: the process as built (mechanical), the loop
// as a block diagram (control), and the P&ID with ISA tags (automation).

export const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
export const flowAnim = (rate: number) => ({ animationDuration: `${Math.min(6, Math.max(0.25, 1.5 / Math.max(rate, 1e-3)))}s` });

/** A globe control valve with a diaphragm actuator, centred on (x, y). `open` 0–100 sets the stem indicator. */
export function ControlValve({ x, y, open, tag, label = true }: { x: number; y: number; open: number; tag: string; label?: boolean }) {
  const stem = 22 - (open / 100) * 10;
  return (
    <g>
      <path className="ll-block" d={`M${x - 18} ${y - 12}L${x + 18} ${y + 12}L${x + 18} ${y - 12}L${x - 18} ${y + 12}Z`} />
      <line className="ll-line" x1={x} y1={y} x2={x} y2={y - 30} />
      <path className="ll-block" d={`M${x - 16} ${y - 30}A16 12 0 0 1 ${x + 16} ${y - 30}Z`} />
      <rect className="ll-fill-steel" x={x - 2} y={y - stem - 8} width={4} height={6} rx={1} />
      {label && <text x={x + 22} y={y - 32}>{tag}</text>}
      {label && <text className="is-muted" x={x + 22} y={y - 19}>{f1(open)} % open</text>}
    </g>
  );
}

/** A hand valve (no actuator). */
export function HandValve({ x, y, open, label, showOpen = true }: { x: number; y: number; open: number; label: string; showOpen?: boolean }) {
  return (
    <g>
      <path className="ll-block" d={`M${x - 14} ${y - 10}L${x + 14} ${y + 10}L${x + 14} ${y - 10}L${x - 14} ${y + 10}Z`} />
      <line className="ll-line" x1={x} y1={y} x2={x} y2={y - 18} />
      <line className="ll-line" x1={x - 8} y1={y - 18} x2={x + 8} y2={y - 18} />
      <text x={x - 20} y={y + 26}>{label}</text>
      {showOpen && <text className="is-muted" x={x - 20} y={y + 39}>{f1(open)} % open</text>}
    </g>
  );
}

export function FlowSchematic({ p, valve, flow, P0 }: { p: Params; valve: number; flow: number; P0: number }) {
  return (
    <svg className="ll-drawing" viewBox="0 0 560 170" role="img" aria-label={`Flow loop: valve ${f1(valve)} % open, flow ${f1(flow)} m³/h`}>
      <rect className="ll-block" x={10} y={78} width={70} height={56} rx={6} />
      <text x={45} y={100} textAnchor="middle">Header</text>
      <text className="is-muted" x={45} y={118} textAnchor="middle">{f1(P0)} bar</text>
      <path className="ll-pipe" d="M80 106H540" />
      {flow > 0.2 && <path className="ll-flowline" style={flowAnim(flow / 30)} d="M84 106H536" />}
      <ControlValve x={220} y={106} open={valve} tag="FV-101" />
      <circle className="ll-block" cx={370} cy={106} r={17} />
      <text x={370} y={110} textAnchor="middle">M</text>
      <text x={358} y={74}>FT-101</text>
      <text className="is-muted" x={358} y={150}>{f1(flow)} m³/h</text>
      <path className="ll-line" d="M528 98L540 106L528 114" />
      <text className="is-muted" x={540} y={140} textAnchor="end">to process, {f1(p.Pback)} bar</text>
    </svg>
  );
}

export function TankSchematic({ p, level, valve, dOut, qIn, qOut }: { p: Params; level: number; valve: number; dOut: number; qIn: number; qOut: number }) {
  const top = 50, bottom = 250, cx = 220, halfTop = 110;
  const scale = halfTop / Math.max(p.R, p.r0);
  const yAt = (h: number) => bottom - (Math.min(Math.max(h, 0), p.H) / p.H) * (bottom - top);
  const half = (h: number) => tankRadius(h, p) * scale;
  const hb = half(0), ht = half(p.H), hl = half(Math.min(Math.max(level, 0), p.H)), yl = yAt(level);
  return (
    <svg className="ll-drawing is-tank" viewBox="0 0 440 320" role="img" aria-label={`Conical tank: level ${level.toFixed(2)} m`}>
      <path className="ll-liquid" d={`M${cx - hb} ${bottom}L${cx - hl} ${yl}L${cx + hl} ${yl}L${cx + hb} ${bottom}Z`} />
      <path className="ll-steel" strokeWidth={3} d={`M${cx - ht} ${top}L${cx - hb} ${bottom}L${cx + hb} ${bottom}L${cx + ht} ${top}`} />
      <line className="ll-guide" x1={cx - hl - 6} x2={cx + hl + 6} y1={yl} y2={yl} />
      <text x={cx} y={Math.min(bottom - 6, yl + 16)} textAnchor="middle">{level.toFixed(3)} m</text>
      {/* Inlet */}
      <path className="ll-pipe" d={`M20 24H${cx}V${top + 8}`} />
      {qIn > 0.05 && <path className="ll-flowline" style={flowAnim(qIn / 6)} d={`M24 24H${cx}V${top + 4}`} />}
      <ControlValve x={110} y={24} open={valve} tag="LV-201" label={false} />
      <text x={20} y={60}>LV-201</text>
      <text className="is-muted" x={20} y={74}>{f1(valve)} % · {f1(qIn)} m³/h in</text>
      {/* Outlet */}
      <path className="ll-pipe" d={`M${cx} ${bottom}V${bottom + 30}H420`} />
      {qOut > 0.05 && <path className="ll-flowline" style={flowAnim(qOut / 6)} d={`M${cx} ${bottom + 4}V${bottom + 30}H416`} />}
      <HandValve x={330} y={bottom + 30} open={dOut} label={`Outlet · ${f1(qOut)} m³/h`} />
      {/* Level transmitter */}
      <line className="ll-signal" x1={cx + ht - 4} y1={top + 40} x2={cx + ht + 40} y2={top + 40} />
      <circle className="ll-bubble" cx={cx + ht + 58} cy={top + 40} r={18} />
      <text x={cx + ht + 58} y={top + 36} textAnchor="middle">LT</text>
      <text x={cx + ht + 58} y={top + 49} textAnchor="middle">201</text>
    </svg>
  );
}

/** ISA-5.1 style instrument bubble. `shared`: a function in the PLC/HMI (circle in a square). */
export function Bubble({ x, y, letters, num, shared }: { x: number; y: number; letters: string; num: string; shared?: boolean }) {
  return (
    <g>
      {shared && <rect className="ll-bubble" x={x - 20} y={y - 20} width={40} height={40} />}
      <circle className="ll-bubble" cx={x} cy={y} r={20} />
      {shared && <line className="ll-line" x1={x - 20} y1={y} x2={x + 20} y2={y} />}
      <text x={x} y={y - 4} textAnchor="middle" fontWeight={700}>{letters}</text>
      <text x={x} y={y + 13} textAnchor="middle">{num}</text>
    </g>
  );
}

export function PAndId({ proc }: { proc: ProcessDef }) {
  const [, tNum] = proc.tags.transmitter.split('-');
  const tLetters = proc.tags.transmitter.split('-')[0];
  const cLetters = proc.tags.loop.split('-')[0];
  const vLetters = proc.tags.valve.split('-')[0];
  if (proc.id === 'tank') {
    return (
      <svg className="ll-drawing" viewBox="0 0 520 356" role="img" aria-label="P&ID of the level loop">
        <path className="ll-steel" strokeWidth={2.5} d="M180 110L230 270H290L340 110Z" />
        <text className="is-muted" x={260} y={200} textAnchor="middle">T-201</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 80H260V110" />
        <ControlValve x={120} y={80} open={50} tag="" label={false} />
        <text x={95} y={112}>{proc.tags.valve}</text>
        <path className="ll-pipe" strokeWidth={3} d="M260 270V300H500" />
        <HandValve x={400} y={300} open={50} label="HV-202" showOpen={false} />
        <line className="ll-signal" x1={326} y1={160} x2={410} y2={160} />
        <Bubble x={430} y={160} letters={tLetters} num={tNum} />
        <line className="ll-signal" x1={430} y1={140} x2={430} y2={80} />
        <Bubble x={430} y={60} letters={cLetters} num={tNum} shared />
        <path className="ll-signal" d="M410 60H150V30H120V38" />
        <text className="is-muted" x={160} y={24}>to {vLetters}-{tNum} positioner</text>
        <text className="is-muted" x={20} y={350}>Dashed: electrical signal · circle in a square: a function in the PLC, shown on the HMI</text>
      </svg>
    );
  }
  return (
    <svg className="ll-drawing" viewBox="0 0 520 220" role="img" aria-label="P&ID of the flow loop">
      <path className="ll-pipe" strokeWidth={3} d="M20 150H500" />
      <text className="is-muted" x={20} y={140}>From header</text>
      <ControlValve x={170} y={150} open={50} tag="" label={false} />
      <text x={150} y={190}>{proc.tags.valve}</text>
      <circle className="ll-block" cx={330} cy={150} r={14} />
      <text x={330} y={154} textAnchor="middle">M</text>
      <line className="ll-signal" x1={330} y1={136} x2={330} y2={100} />
      <Bubble x={330} y={80} letters={tLetters} num={tNum} />
      <line className="ll-signal" x1={310} y1={80} x2={270} y2={80} />
      <line className="ll-signal" x1={270} y1={80} x2={270} y2={40} />
      <Bubble x={250} y={30} letters={cLetters} num={tNum} shared />
      <path className="ll-signal" d="M230 30H170V103" />
      <text className="is-muted" x={20} y={212}>Dashed: electrical signal · circle in a square: a function in the PLC, shown on the HMI</text>
      <text className="is-muted" x={500} y={140} textAnchor="end">to process</text>
    </svg>
  );
}

// ─── Block diagram ──────────────────────────────────────────────────────────

export type ProbeKey = 'sp' | 'cv' | 'valve' | 'pvTrue' | 'pv' | 'P' | 'I' | 'D' | 'Kc' | 'ff' | 'sp2' | 'pv2' | `dist:${string}`;

/** A one-line description of each process for its block. */
const PROCESS_SUB: Record<string, string> = {
  flow: 'Q = K_v f √Δp', tank: 'A(h)·ḣ = Qᵢₙ − Qₒᵤₜ', stirred: 'jacket → vessel', hx: 'wall → fluid', custom: 'K e^(−θs)/(τs + 1)',
};

export function Block({ x, y, w, h, title, sub, ctrl }: { x: number; y: number; w: number; h: number; title: string; sub?: string; ctrl?: boolean }) {
  return (
    <g>
      <rect className={`ll-block${ctrl ? ' is-ctrl' : ''}`} x={x} y={y} width={w} height={h} rx={4} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 3 : h / 2 + 4)} textAnchor="middle" fontWeight={700}>{title}</text>
      {sub && <text className="is-muted" x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle">{sub}</text>}
    </g>
  );
}

/** A summing junction (or, with symbol ×, a product: steam flow = valve × pressure). */
export function Sum({ x, y, signs, symbol = 'Σ' }: { x: number; y: number; signs: string; symbol?: string }) {
  return (
    <g>
      <circle className="ll-sum" cx={x} cy={y} r={11} />
      <text x={x} y={y + 4} textAnchor="middle">{symbol}</text>
      <text className="is-muted" x={x - 18} y={y - 6}>{signs[0]}</text>
      <text className="is-muted" x={x + 4} y={y + 26}>{signs[1]}</text>
    </g>
  );
}

export const arrowHead = (x: number, y: number, dir: 'r' | 'l' | 'u' | 'd') => {
  const s = 6;
  if (dir === 'r') return `M${x - s} ${y - s / 1.6}L${x} ${y}L${x - s} ${y + s / 1.6}`;
  if (dir === 'l') return `M${x + s} ${y - s / 1.6}L${x} ${y}L${x + s} ${y + s / 1.6}`;
  if (dir === 'u') return `M${x - s / 1.6} ${y + s}L${x} ${y}L${x + s / 1.6} ${y + s}`;
  return `M${x - s / 1.6} ${y - s}L${x} ${y}L${x + s / 1.6} ${y - s}`;
};

/**
 * The loop as a block diagram, drawn from its actual structure. Wire labels
 * are probes: clicking one plots that signal.
 */
export function BlockDiagram({ proc, config, probes = [], onProbe }: {
  proc: ProcessDef; config: ControllerConfig; probes?: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  if (config.kind === 'cascade') return <CascadeDiagram proc={proc} config={config} probes={probes} onProbe={onProbe} />;
  const ff = config.kind === 'feedforward' ? config.ff : [];
  const ffOn = ff.length > 0;
  const ch = config.kind === 'characterized' ? findCharacterization(proc, config.char) : undefined;
  const pvChar = ch?.on === 'pv', cvChar = ch?.on === 'cv';
  const Y = 110, FB = 215;
  const wire = (key: ProbeKey | null, d: string, end?: { x: number; y: number; dir: 'r' | 'l' | 'u' | 'd' }) => (
    <g>
      <path className={`ll-wire${key && probes.includes(key) ? ' is-probe' : ''}`} d={d} />
      {end && <path className="ll-wire" d={arrowHead(end.x, end.y, end.dir)} />}
    </g>
  );
  const probe = (key: ProbeKey, x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'middle') => (
    <g className="ll-probe" role="button" tabIndex={onProbe ? 0 : -1} aria-pressed={probes.includes(key)}
      onClick={() => onProbe?.(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProbe?.(key); } }}>
      <text x={x} y={y} textAnchor={anchor}>{text}</text>
    </g>
  );
  const firstDist = proc.disturbances[0];

  // x positions along the forward path
  const xSum = pvChar ? 150 : 110;
  const xC = xSum + 30, wC = 160;
  const xF = xC + wC + 28;
  const xG = xC + wC + 30 + (cvChar ? 80 : 0) + (ffOn ? 50 : 0);
  const xV = xG, wV = 110;
  const xLoad = xV + wV + 35;
  const xP = xLoad + 30, wP = 120;
  const xOut = xP + wP + 50;

  const ctrlTitle = config.kind === 'onoff' ? 'Relay' : config.kind === 'schedule' ? 'PID (scheduled)' : 'PID';
  const ffNames = ff.map((t) => proc.disturbances.find((d) => d.key === t.from)?.label.toLowerCase() ?? t.from).join(', ');
  const ctrlSub = config.kind === 'onoff' ? `± ${config.hyst} % band` : 'Kc·(1 + 1/Ti·s + Td·s)';

  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 20} 270`} role="img" aria-label={`Block diagram: ${ctrlTitle} on the ${proc.name.toLowerCase()}`}>
      {/* Setpoint in */}
      {probe('sp', 14, Y - 8, 'SP r', 'start')}
      {pvChar ? (
        <>
          {wire('sp', `M10 ${Y}H40`, { x: 40, y: Y, dir: 'r' })}
          <Block x={40} y={Y - 18} w={70} h={36} title="f(·)" sub="SP → vol." />
          {wire(null, `M110 ${Y}H${xSum - 11}`, { x: xSum - 11, y: Y, dir: 'r' })}
        </>
      ) : wire('sp', `M10 ${Y}H${xSum - 11}`, { x: xSum - 11, y: Y, dir: 'r' })}
      <Sum x={xSum} y={Y} signs="+−" />
      {wire(null, `M${xSum + 11} ${Y}H${xC}`, { x: xC, y: Y, dir: 'r' })}
      <Block x={xC} y={Y - 24} w={wC} h={48} title={ctrlTitle} sub={ctrlSub} ctrl />
      {config.kind !== 'onoff' && (
        <>
          {probe('P', xC + 30, Y + 40, 'P')}
          {probe('I', xC + wC / 2, Y + 40, 'I')}
          {probe('D', xC + wC - 30, Y + 40, 'D')}
        </>
      )}
      {config.kind === 'schedule' && (
        <>
          <Block x={xC + 15} y={18} w={wC - 30} h={34} title="Gain table" sub={`on ${config.on.toUpperCase()}`} ctrl />
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xC + wC / 2} 52V${Y - 24}`} />
          <path className="ll-wire" d={arrowHead(xC + wC / 2, Y - 24, 'd')} />
          {probe('Kc', xC + wC / 2 + 8, 72, 'Kc', 'start')}
          <path className="ll-wire" strokeDasharray="4 3" d={`M${config.on === 'sp' ? 24 : xOut - 20} ${config.on === 'sp' ? Y : FB}V35H${xC + 15}`} />
        </>
      )}
      {/* Controller output → (characterization) → valve */}
      {cvChar ? (
        <>
          {wire('cv', `M${xC + wC} ${Y}H${xC + wC + 20}`, { x: xC + wC + 20, y: Y, dir: 'r' })}
          <Block x={xC + wC + 20} y={Y - 18} w={70} h={36} title="g⁻¹(·)" sub="valve inv." />
          {wire(null, `M${xC + wC + 90} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', xC + wC + 12, Y - 26, 'CV u')}
        </>
      ) : ffOn ? (
        <>
          {wire(null, `M${xC + wC} ${Y}H${xF - 11}`, { x: xF - 11, y: Y, dir: 'r' })}
          <Sum x={xF} y={Y} signs="++" />
          <Block x={xF - 40} y={22} w={80} h={34} title="FF" sub="K(Ls + 1)/(Ts + 1)" ctrl />
          {wire('ff', `M${xF} 56V${Y - 11}`, { x: xF, y: Y - 11, dir: 'd' })}
          {probe('ff', xF + 6, 76, 'ff', 'start')}
          <path className="ll-wire" d={`M${xC} 39H${xF - 40}`} />
          <path className="ll-wire" d={arrowHead(xF - 40, 39, 'r')} />
          <text className="is-muted" x={xC} y={32}>measured: {ffNames}</text>
          {wire('cv', `M${xF + 11} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', xF + 30, Y - 8, 'CV u')}
        </>
      ) : (
        <>
          {wire('cv', `M${xC + wC} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', xC + wC + 15, Y - 8, 'CV u')}
        </>
      )}
      <Block x={xV} y={Y - 24} w={wV} h={48} title="Valve" sub="1/(τᵥs + 1), char." />
      {wire('valve', `M${xV + wV} ${Y}H${xLoad - 11}`, { x: xLoad - 11, y: Y, dir: 'r' })}
      {probe('valve', xV + wV + 12, Y - 8, 'stem', 'middle')}
      <Sum x={xLoad} y={Y} signs="++" />
      {firstDist && (
        <>
          {wire(`dist:${firstDist.key}`, `M${xLoad} ${Y - 60}V${Y - 11}`, { x: xLoad, y: Y - 11, dir: 'd' })}
          {probe(`dist:${firstDist.key}`, xLoad, Y - 66, `d: ${firstDist.label.toLowerCase()}`)}
        </>
      )}
      {wire(null, `M${xLoad + 11} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 25, Y - 8, 'PV y')}
      {/* Feedback through the transmitter */}
      {wire('pv', `M${xOut - 20} ${Y}V${FB}H${xP + wP}`, { x: xP + wP, y: FB, dir: 'l' })}
      <Block x={xP} y={FB - 22} w={wP} h={44} title="Transmitter" sub="e^(−θs)/(τₘs + 1)" />
      <Sum x={xV + wV / 2} y={FB} signs="++" />
      {wire(null, `M${xP} ${FB}H${xV + wV / 2 + 11}`, { x: xV + wV / 2 + 11, y: FB, dir: 'l' })}
      <text className="is-muted" x={xV + wV / 2} y={FB - 22} textAnchor="middle">noise n</text>
      <path className="ll-wire" d={`M${xV + wV / 2} ${FB - 16}V${FB - 11}`} />
      {pvChar ? (
        <>
          {wire('pv', `M${xV + wV / 2 - 11} ${FB}H110`, { x: 110, y: FB, dir: 'l' })}
          <Block x={40} y={FB - 18} w={70} h={36} title="f(·)" sub="level → vol." />
          <path className="ll-wire" d={`M40 ${FB}H25V${FB + 30}H${xSum}V${Y + 11}`} />
          <path className="ll-wire" d={arrowHead(xSum, Y + 11, 'u')} />
        </>
      ) : (
        <>
          {wire('pv', `M${xV + wV / 2 - 11} ${FB}H${xSum}V${Y + 11}`, { x: xSum, y: Y + 11, dir: 'u' })}
        </>
      )}
      {probe('pv', (xSum + xV) / 2, FB - 6, 'PV measured')}
      <text className="is-muted" x={xOut + 10} y={Y + 4} textAnchor="end" />
    </svg>
  );
}

/** Cascade: master on the main PV sets the slave's setpoint; the slave closes a fast loop around the valve. */
function CascadeDiagram({ proc, config, probes, onProbe }: {
  proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'cascade' }>; probes: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  const sec = proc.secondary!;
  const Y = 120, FB2 = 190, FB1 = 250;
  const ffOn = config.ff.length > 0;
  const wire = (key: ProbeKey | null, d: string, end?: { x: number; y: number; dir: 'r' | 'l' | 'u' | 'd' }) => (
    <g>
      <path className={`ll-wire${key && probes.includes(key) ? ' is-probe' : ''}`} d={d} />
      {end && <path className="ll-wire" d={arrowHead(end.x, end.y, end.dir)} />}
    </g>
  );
  const probe = (key: ProbeKey, x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'middle') => (
    <g className="ll-probe" role="button" tabIndex={onProbe ? 0 : -1} aria-pressed={probes.includes(key)}
      onClick={() => onProbe?.(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProbe?.(key); } }}>
      <text x={x} y={y} textAnchor={anchor}>{text}</text>
    </g>
  );
  const s1 = 70, xM = 95, wM = 110;
  const xF = xM + wM + 28;
  const s2 = xF + (ffOn ? 42 : 0) + 20, xS = s2 + 25, wS = 100;
  const xV = xS + wS + 25, wV = 90;
  const sP = xV + wV + 28;
  const xQ = sP + 25, wQ = 92;
  const xP = xQ + wQ + 35, wP = 100;
  const xOut = xP + wP + 40;
  const press = proc.disturbances.find((d) => !d.measured);
  const measured = proc.disturbances.filter((d) => d.measured);
  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 15} 290`} role="img" aria-label={`Block diagram: cascade control of the ${proc.name.toLowerCase()}`}>
      {probe('sp', 12, Y - 8, 'SP r', 'start')}
      {wire('sp', `M8 ${Y}H${s1 - 11}`, { x: s1 - 11, y: Y, dir: 'r' })}
      <Sum x={s1} y={Y} signs="+−" />
      {wire(null, `M${s1 + 11} ${Y}H${xM}`, { x: xM, y: Y, dir: 'r' })}
      <Block x={xM} y={Y - 24} w={wM} h={48} title="Master PID" sub={proc.tags.loop} ctrl />
      {probe('P', xM + 20, Y + 38, 'P')}
      {probe('I', xM + wM / 2, Y + 38, 'I')}
      {probe('D', xM + wM - 20, Y + 38, 'D')}
      {ffOn ? (
        <>
          {wire(null, `M${xM + wM} ${Y}H${xF - 11}`, { x: xF - 11, y: Y, dir: 'r' })}
          <Sum x={xF} y={Y} signs="++" />
          <Block x={xF - 40} y={28} w={80} h={34} title="FF" sub="K(Ls + 1)/(Ts + 1)" ctrl />
          {wire('ff', `M${xF} 62V${Y - 11}`, { x: xF, y: Y - 11, dir: 'd' })}
          {probe('ff', xF + 6, 82, 'ff', 'start')}
          <path className="ll-wire" d={`M${xM} 45H${xF - 40}`} />
          <path className="ll-wire" d={arrowHead(xF - 40, 45, 'r')} />
          <text className="is-muted" x={xM} y={38}>measured: {config.ff.map((t) => proc.disturbances.find((d) => d.key === t.from)?.label.toLowerCase() ?? t.from).join(', ')}</text>
          {wire('sp2', `M${xF + 11} ${Y}H${s2 - 11}`, { x: s2 - 11, y: Y, dir: 'r' })}
        </>
      ) : wire('sp2', `M${xM + wM} ${Y}H${s2 - 11}`, { x: s2 - 11, y: Y, dir: 'r' })}
      {probe('sp2', s2 - 22, Y - 8, 'SP₂')}
      <Sum x={s2} y={Y} signs="+−" />
      {wire(null, `M${s2 + 11} ${Y}H${xS}`, { x: xS, y: Y, dir: 'r' })}
      <Block x={xS} y={Y - 24} w={wS} h={48} title="Slave PID" sub={sec.loopTag} ctrl />
      {wire('cv', `M${xS + wS} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
      {probe('cv', xS + wS + 12, Y - 8, 'CV u')}
      <Block x={xV} y={Y - 24} w={wV} h={48} title="Valve" sub="1/(τᵥs + 1)" />
      {wire('valve', `M${xV + wV} ${Y}H${sP - 11}`, { x: sP - 11, y: Y, dir: 'r' })}
      <Sum x={sP} y={Y} signs="" symbol="×" />
      {press && (
        <>
          {wire(`dist:${press.key}`, `M${sP} ${Y - 55}V${Y - 11}`, { x: sP, y: Y - 11, dir: 'd' })}
          {probe(`dist:${press.key}`, sP, Y - 61, `${press.label.toLowerCase()}`)}
        </>
      )}
      {wire(null, `M${sP + 11} ${Y}H${xQ}`, { x: xQ, y: Y, dir: 'r' })}
      <Block x={xQ} y={Y - 24} w={wQ} h={48} title={sec.label} sub={sec.unit} />
      {wire(null, `M${xQ + wQ} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      {measured.length > 0 && (
        <>
          {wire(`dist:${measured[0].key}`, `M${xP + wP / 2} ${Y - 55}V${Y - 24}`, { x: xP + wP / 2, y: Y - 24, dir: 'd' })}
          {probe(`dist:${measured[0].key}`, xP + wP / 2, Y - 61, measured.map((d) => d.label.toLowerCase()).join(', '))}
        </>
      )}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 18, Y - 8, 'PV y')}
      {/* Inner loop: secondary transmitter back to the slave */}
      {wire('pv2', `M${xQ + wQ + 15} ${Y}V${FB2}H${xQ + wQ}`, { x: xQ + wQ, y: FB2, dir: 'l' })}
      <Block x={xQ} y={FB2 - 18} w={wQ} h={36} title={sec.tag} sub="1/(τₘ₂s + 1)" />
      {wire('pv2', `M${xQ} ${FB2}H${s2}V${Y + 11}`, { x: s2, y: Y + 11, dir: 'u' })}
      {probe('pv2', (s2 + xQ) / 2, FB2 - 6, `${sec.label} measured`)}
      {/* Outer loop: main transmitter back to the master */}
      {wire('pv', `M${xOut - 15} ${Y}V${FB1}H${xP + wP}`, { x: xP + wP, y: FB1, dir: 'l' })}
      <Block x={xP} y={FB1 - 20} w={wP} h={40} title={proc.tags.transmitter} sub="e^(−θs)/(τₘs + 1)" />
      {wire('pv', `M${xP} ${FB1}H${s1}V${Y + 11}`, { x: s1, y: Y + 11, dir: 'u' })}
      {probe('pv', (s1 + xP) / 2, FB1 - 6, 'PV measured')}
    </svg>
  );
}
