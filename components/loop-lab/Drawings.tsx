'use client';

import type { ControllerConfig } from '@/lib/loop-lab/controllers';
import { findCharacterization } from '@/lib/loop-lab/controllers';
import { upsets as upsetList, type Params, type ProcessDef } from '@/lib/loop-lab/model';
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

export type ProbeKey = 'sp' | 'cv' | 'valve' | 'pvTrue' | 'pv' | 'P' | 'I' | 'D' | 'Kc' | 'ff' | 'sp2' | 'pv2' | 'pred' | 'alt' | 'cv2' | 'valve2' | 'pv2True' | `dist:${string}`;

/** A one-line description of each process for its block. */
const PROCESS_SUB: Record<string, string> = {
  flow: 'Q = K_v f √Δp', tank: 'A(h)·ḣ = Qᵢₙ − Qₒᵤₜ', stirred: 'jacket → vessel', hx: 'wall → fluid',
  surge: 'A·ḣ = Qᵢₙ − Qₒᵤₜ', feeder: 'screw, then belt', drum: 'inventory + swell − shrink', jacket: 'split: cool | heat', blend: 'V·ċ = F_B·c_B − F·c',
  mixing: 'A·ḣ = F_h + F_c − F_out', batch: 'A → B + heat', crane: 'trolley + pendulum', servo: 'two masses, a spring', maglev: 'mẍ = mg − F(i, x)', custom: 'K e^(−θs)/(τs + 1)',
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
  if (config.kind === 'cascade' || config.kind === 'ratio') return <CascadeDiagram proc={proc} config={config} probes={probes} onProbe={onProbe} />;
  if (config.kind === 'override') return <OverrideDiagram proc={proc} config={config} probes={probes} onProbe={onProbe} />;
  if (config.kind === 'statefb') return <StateFbDiagram proc={proc} config={config} probes={probes} onProbe={onProbe} />;
  if ((config.kind === 'multiloop' || config.kind === 'mpc') && proc.mimo) return <MimoDiagram proc={proc} config={config} probes={probes} onProbe={onProbe} />;
  const ff = config.kind === 'feedforward' ? config.ff : [];
  const ffOn = ff.length > 0;
  const ch = config.kind === 'characterized' ? findCharacterization(proc, config.char) : undefined;
  const pvChar = ch?.on === 'pv', cvChar = ch?.on === 'cv';
  const Y = 115, FB = 230;
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
  const firstDist = upsetList(proc)[0];

  // x positions along the forward path (generous wire gaps for clear signal flow & probes)
  const xSum = pvChar ? 175 : 120;
  const xC = xSum + 46, wC = 164;
  const xF = xC + wC + 46;
  const xG = xC + wC + (cvChar ? 130 : ffOn ? 92 : 58);
  const xV = xG, wV = 114;
  const xLoad = xV + wV + 54;
  const xP = xLoad + 44, wP = 126;
  const xOut = xP + wP + 68;

  const smith = config.kind === 'smith';
  const ctrlTitle = config.kind === 'onoff' ? 'Relay' : config.kind === 'schedule' ? 'PID (scheduled)' : config.kind === 'adaptive' ? 'PI (self-tuned)' : config.kind === 'adrc' ? 'ADRC' : config.kind === 'custom' ? 'Your ST code' : 'PID';
  const ffNames = ff.map((t) => proc.disturbances.find((d) => d.key === t.from)?.label.toLowerCase() ?? t.from).join(', ');
  const ctrlSub = config.kind === 'onoff' ? `± ${config.hyst} % band` : config.kind === 'adrc' ? 'observer + cancel f' : config.kind === 'custom' ? 'LL_Custom' : 'Kc·(1 + 1/Ti·s + Td·s)';

  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 24} ${smith ? 318 : 285}`} role="img" aria-label={`Block diagram: ${smith ? 'Smith predictor' : ctrlTitle} on the ${proc.name.toLowerCase()}`}>
      {/* Setpoint in */}
      {probe('sp', 14, Y - 10, 'SP r', 'start')}
      {pvChar ? (
        <>
          {wire('sp', `M10 ${Y}H48`, { x: 48, y: Y, dir: 'r' })}
          <Block x={48} y={Y - 18} w={76} h={36} title="f(·)" sub="SP → vol." />
          {wire(null, `M124 ${Y}H${xSum - 11}`, { x: xSum - 11, y: Y, dir: 'r' })}
        </>
      ) : wire('sp', `M10 ${Y}H${xSum - 11}`, { x: xSum - 11, y: Y, dir: 'r' })}
      <Sum x={xSum} y={Y} signs="+−" />
      {wire(null, `M${xSum + 11} ${Y}H${xC}`, { x: xC, y: Y, dir: 'r' })}
      <Block x={xC} y={Y - 24} w={wC} h={48} title={ctrlTitle} sub={ctrlSub} ctrl />
      {config.kind !== 'onoff' && config.kind !== 'custom' && (
        <>
          {probe('P', xC + 30, Y + 40, 'P')}
          {probe('I', xC + wC / 2, Y + 40, 'I')}
          {probe('D', xC + wC - 30, Y + 40, 'D')}
        </>
      )}
      {config.kind === 'adaptive' && (
        <>
          <Block x={xC + 15} y={18} w={wC - 30} h={34} title="RLS → SIMC" sub="fits a model, retunes" ctrl />
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xC + wC / 2} 52V${Y - 24}`} />
          <path className="ll-wire" d={arrowHead(xC + wC / 2, Y - 24, 'd')} />
          {probe('Kc', xC + wC / 2 + 8, 72, 'Kc', 'start')}
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xOut - 24} ${FB}V35H${xC + wC - 15}`} />
        </>
      )}
      {config.kind === 'schedule' && (
        <>
          <Block x={xC + 15} y={18} w={wC - 30} h={34} title="Gain table" sub={`on ${config.on.toUpperCase()}`} ctrl />
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xC + wC / 2} 52V${Y - 24}`} />
          <path className="ll-wire" d={arrowHead(xC + wC / 2, Y - 24, 'd')} />
          {probe('Kc', xC + wC / 2 + 8, 72, 'Kc', 'start')}
          <path className="ll-wire" strokeDasharray="4 3" d={`M${config.on === 'sp' ? 24 : xOut - 24} ${config.on === 'sp' ? Y : FB}V35H${xC + 15}`} />
        </>
      )}
      {/* Controller output → (characterization) → valve */}
      {cvChar ? (
        <>
          {wire('cv', `M${xC + wC} ${Y}H${xC + wC + 28}`, { x: xC + wC + 28, y: Y, dir: 'r' })}
          <Block x={xC + wC + 28} y={Y - 18} w={74} h={36} title="g⁻¹(·)" sub="valve inv." />
          {wire(null, `M${xC + wC + 102} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', xC + wC + 14, Y - 26, 'CV u')}
        </>
      ) : ffOn ? (
        <>
          {wire(null, `M${xC + wC} ${Y}H${xF - 11}`, { x: xF - 11, y: Y, dir: 'r' })}
          <Sum x={xF} y={Y} signs="++" />
          <Block x={xF - 42} y={22} w={84} h={34} title="FF" sub="K(Ls + 1)/(Ts + 1)" ctrl />
          {wire('ff', `M${xF} 56V${Y - 11}`, { x: xF, y: Y - 11, dir: 'd' })}
          {probe('ff', xF + 6, 76, 'ff', 'start')}
          <path className="ll-wire" d={`M${xC} 39H${xF - 42}`} />
          <path className="ll-wire" d={arrowHead(xF - 42, 39, 'r')} />
          <text className="is-muted" x={xC} y={32}>measured: {ffNames}</text>
          {wire('cv', `M${xF + 11} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', (xF + 11 + xV) / 2, Y - 10, 'CV u')}
        </>
      ) : (
        <>
          {wire('cv', `M${xC + wC} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
          {probe('cv', (xC + wC + xV) / 2, Y - 10, 'CV u')}
        </>
      )}
      <Block x={xV} y={Y - 24} w={wV} h={48} title="Valve" sub="1/(τᵥs + 1), char." />
      {wire('valve', `M${xV + wV} ${Y}H${xLoad - 11}`, { x: xLoad - 11, y: Y, dir: 'r' })}
      {probe('valve', (xV + wV + xLoad - 11) / 2, Y - 10, 'stem', 'middle')}
      <Sum x={xLoad} y={Y} signs="++" />
      {firstDist && (
        <>
          {wire(`dist:${firstDist.key}`, `M${xLoad} ${Y - 62}V${Y - 11}`, { x: xLoad, y: Y - 11, dir: 'd' })}
          {probe(`dist:${firstDist.key}`, xLoad, Y - 68, `d: ${firstDist.label.toLowerCase()}`)}
        </>
      )}
      {wire(null, `M${xLoad + 11} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 32, Y - 10, 'PV y')}
      {/* Feedback through the transmitter */}
      {wire('pv', `M${xOut - 24} ${Y}V${FB}H${xP + wP}`, { x: xP + wP, y: FB, dir: 'l' })}
      <Block x={xP} y={FB - 22} w={wP} h={44} title="Transmitter" sub="e^(−θs)/(τₘs + 1)" />
      <Sum x={xV + wV / 2} y={FB} signs="++" />
      {wire(null, `M${xP} ${FB}H${xV + wV / 2 + 11}`, { x: xV + wV / 2 + 11, y: FB, dir: 'l' })}
      <text className="is-muted" x={xV + wV / 2} y={FB - 24} textAnchor="middle">noise n</text>
      <path className="ll-wire" d={`M${xV + wV / 2} ${FB - 18}V${FB - 11}`} />
      {pvChar ? (
        <>
          {wire('pv', `M${xV + wV / 2 - 11} ${FB}H124`, { x: 124, y: FB, dir: 'l' })}
          <Block x={48} y={FB - 18} w={76} h={36} title="f(·)" sub="level → vol." />
          <path className="ll-wire" d={`M48 ${FB}H28V${FB + 34}H${xSum}V${Y + 11}`} />
          <path className="ll-wire" d={arrowHead(xSum, Y + 11, 'u')} />
        </>
      ) : smith ? (
        <>
          {/* Smith predictor: the model's (undelayed − delayed) output is added to the measurement. */}
          {wire('pv', `M${xV + wV / 2 - 11} ${FB}H${xSum + 11}`, { x: xSum + 11, y: FB, dir: 'l' })}
          <Sum x={xSum} y={FB} signs="++" />
          {wire('pred', `M${xSum} ${FB - 11}V${Y + 11}`, { x: xSum, y: Y + 11, dir: 'u' })}
          {probe('pred', xSum - 8, (Y + FB) / 2 + 4, 'predicted', 'end')}
          <path className="ll-wire" d={`M${xC + wC + 16} ${Y}V${FB + 54}H${xC + wC - 10}`} />
          <path className="ll-wire" d={arrowHead(xC + wC - 10, FB + 54, 'l')} />
          <Block x={xC + 10} y={FB + 36} w={wC - 20} h={36} title="Model" sub="Kₘ(1 − e^(−θₘs))/(τₘs + 1)" ctrl />
          <path className="ll-wire" d={`M${xC + 10} ${FB + 54}H${xSum}V${FB + 11}`} />
          <path className="ll-wire" d={arrowHead(xSum, FB + 11, 'u')} />
        </>
      ) : (
        <>
          {wire('pv', `M${xV + wV / 2 - 11} ${FB}H${xSum}V${Y + 11}`, { x: xSum, y: Y + 11, dir: 'u' })}
        </>
      )}
      {probe('pv', (xSum + xV) / 2, FB - 8, 'PV measured')}
      <text className="is-muted" x={xOut + 10} y={Y + 4} textAnchor="end" />
    </svg>
  );
}

/**
 * Cascade: master on the main PV sets the slave's setpoint; the slave closes a fast loop around the valve.
 * Ratio is drawn the same way, with the master's output (the ratio) multiplied by the wild flow.
 */
function CascadeDiagram({ proc, config, probes, onProbe }: {
  proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'cascade' | 'ratio' }>; probes: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  const sec = proc.secondary!;
  const Y = 120, FB2 = 205, FB1 = 272;
  const ratio = config.kind === 'ratio';
  const ffOn = config.kind === 'cascade' && config.ff.length > 0;
  const outerOn = !ratio || config.trim;
  const wild = ratio ? proc.disturbances.find((d) => d.key === proc.ratio?.from) : undefined;
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
  const s1 = 80, xM = 118, wM = 116;
  const xF = xM + wM + 42;
  const s2 = xF + (ffOn || ratio ? 52 : 16), xS = s2 + 38, wS = 106;
  const xV = xS + wS + 48, wV = 94;
  const sP = xV + wV + 40;
  const xQ = sP + 38, wQ = 96;
  const xP = xQ + wQ + 54, wP = 108;
  const xOut = xP + wP + 58;
  const press = proc.disturbances.find((d) => (sec.upset ? d.key === sec.upset : !d.measured));
  const measured = proc.disturbances.filter((d) => d.measured);
  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 20} 312`} role="img" aria-label={`Block diagram: ${ratio ? 'ratio' : 'cascade'} control of the ${proc.name.toLowerCase()}`}>
      {outerOn && (
        <>
          {probe('sp', 12, Y - 10, 'SP r', 'start')}
          {wire('sp', `M8 ${Y}H${s1 - 11}`, { x: s1 - 11, y: Y, dir: 'r' })}
          <Sum x={s1} y={Y} signs="+−" />
          {wire(null, `M${s1 + 11} ${Y}H${xM}`, { x: xM, y: Y, dir: 'r' })}
          {probe('P', xM + 20, Y + 38, 'P')}
          {probe('I', xM + wM / 2, Y + 38, 'I')}
          {probe('D', xM + wM - 20, Y + 38, 'D')}
        </>
      )}
      <Block x={xM} y={Y - 24} w={wM} h={48} title={ratio ? (outerOn ? 'Trim PID' : 'Ratio R') : 'Master PID'}
        sub={ratio ? (outerOn ? `R ${config.rLo}–${config.rHi}` : `fixed at ${config.ratio}`) : proc.tags.loop} ctrl />
      {ratio ? (
        <>
          {wire(null, `M${xM + wM} ${Y}H${xF - 11}`, { x: xF - 11, y: Y, dir: 'r' })}
          {probe('cv', (xM + wM + xF - 11) / 2, Y - 10, 'R')}
          <Sum x={xF} y={Y} signs="" symbol="×" />
          {wire(wild ? `dist:${wild.key}` : null, `M${xF} 52V${Y - 11}`, { x: xF, y: Y - 11, dir: 'd' })}
          {wild && probe(`dist:${wild.key}`, xF, 44, `${wild.label.toLowerCase()} (${wild.measured})`)}
          {wire('sp2', `M${xF + 11} ${Y}H${s2 - 11}`, { x: s2 - 11, y: Y, dir: 'r' })}
        </>
      ) : ffOn ? (
        <>
          {wire(null, `M${xM + wM} ${Y}H${xF - 11}`, { x: xF - 11, y: Y, dir: 'r' })}
          <Sum x={xF} y={Y} signs="++" />
          <Block x={xF - 40} y={28} w={80} h={34} title="FF" sub="K(Ls + 1)/(Ts + 1)" ctrl />
          {wire('ff', `M${xF} 62V${Y - 11}`, { x: xF, y: Y - 11, dir: 'd' })}
          {probe('ff', xF + 6, 82, 'ff', 'start')}
          <path className="ll-wire" d={`M${xM} 45H${xF - 40}`} />
          <path className="ll-wire" d={arrowHead(xF - 40, 45, 'r')} />
          <text className="is-muted" x={xM} y={38}>measured: {(config.kind === 'cascade' ? config.ff : []).map((t) => proc.disturbances.find((d) => d.key === t.from)?.label.toLowerCase() ?? t.from).join(', ')}</text>
          {wire('sp2', `M${xF + 11} ${Y}H${s2 - 11}`, { x: s2 - 11, y: Y, dir: 'r' })}
        </>
      ) : wire('sp2', `M${xM + wM} ${Y}H${s2 - 11}`, { x: s2 - 11, y: Y, dir: 'r' })}
      {probe('sp2', s2 - 28, Y - 10, 'SP₂')}
      <Sum x={s2} y={Y} signs="+−" />
      {wire(null, `M${s2 + 11} ${Y}H${xS}`, { x: xS, y: Y, dir: 'r' })}
      <Block x={xS} y={Y - 24} w={wS} h={48} title="Slave PID" sub={sec.loopTag} ctrl />
      {wire('cv', `M${xS + wS} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
      {probe('cv', (xS + wS + xV) / 2, Y - 10, 'CV u')}
      <Block x={xV} y={Y - 24} w={wV} h={48} title="Valve" sub="1/(τᵥs + 1)" />
      {wire('valve', `M${xV + wV} ${Y}H${sP - 11}`, { x: sP - 11, y: Y, dir: 'r' })}
      <Sum x={sP} y={Y} signs="" symbol="×" />
      {press && (
        <>
          {wire(`dist:${press.key}`, `M${sP} ${Y - 58}V${Y - 11}`, { x: sP, y: Y - 11, dir: 'd' })}
          {probe(`dist:${press.key}`, sP, Y - 64, `${press.label.toLowerCase()}`)}
        </>
      )}
      {wire(null, `M${sP + 11} ${Y}H${xQ}`, { x: xQ, y: Y, dir: 'r' })}
      <Block x={xQ} y={Y - 24} w={wQ} h={48} title={sec.label} sub={sec.unit} />
      {wire(null, `M${xQ + wQ} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      {measured.length > 0 && (
        <>
          {wire(`dist:${measured[0].key}`, `M${xP + wP / 2} ${Y - 58}V${Y - 24}`, { x: xP + wP / 2, y: Y - 24, dir: 'd' })}
          {probe(`dist:${measured[0].key}`, xP + wP / 2, Y - 64, measured.map((d) => d.label.toLowerCase()).join(', '))}
        </>
      )}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 26, Y - 10, 'PV y')}
      {/* Inner loop: secondary transmitter back to the slave */}
      {wire('pv2', `M${xQ + wQ + 24} ${Y}V${FB2}H${xQ + wQ}`, { x: xQ + wQ, y: FB2, dir: 'l' })}
      <Block x={xQ} y={FB2 - 18} w={wQ} h={36} title={sec.tag} sub="1/(τₘ₂s + 1)" />
      {wire('pv2', `M${xQ} ${FB2}H${s2}V${Y + 11}`, { x: s2, y: Y + 11, dir: 'u' })}
      {probe('pv2', (s2 + xQ) / 2, FB2 - 8, `${sec.label} measured`)}
      {/* Outer loop: main transmitter back to the master */}
      {wire('pv', `M${xOut - 20} ${Y}V${FB1}H${xP + wP}`, { x: xP + wP, y: FB1, dir: 'l' })}
      <Block x={xP} y={FB1 - 20} w={wP} h={40} title={proc.tags.transmitter} sub="e^(−θs)/(τₘs + 1)" />
      {outerOn && wire('pv', `M${xP} ${FB1}H${s1}V${Y + 11}`, { x: s1, y: Y + 11, dir: 'u' })}
      {outerOn && probe('pv', (s1 + xP) / 2, FB1 - 8, 'PV measured')}
    </svg>
  );
}

/**
 * State feedback: the setpoint through N_r, minus K times the observer's estimate of every state, plus
 * the offset remover (an integral of the error, or the estimated disturbance through N_d).
 */
function StateFbDiagram({ proc, config, probes, onProbe }: {
  proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'statefb' }>; probes: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  const sec = proc.secondary;
  const uses2 = !!sec && config.measure !== 'pv', uses1 = config.measure !== 'pv2' || !sec;
  const Y = 85, YO = 215, FB = 315;
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
  const xN = 64, wN = 56, xS = 180, xV = 246, wV = 106, xP = 410, wP = 126, xOut = xP + wP + 64;
  const xO = 246, wO = 210, xK = 76, wK = 76;
  const firstDist = upsetList(proc)[0];
  const extra = config.integral === 'error' ? '∫(r − y)·K_z' : config.integral === 'dist' ? 'd̂ · N_d' : null;
  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 20} 355`} role="img" aria-label={`Block diagram: state feedback with an observer on the ${proc.name.toLowerCase()}`}>
      {probe('sp', 10, Y - 10, 'SP r', 'start')}
      {wire('sp', `M6 ${Y}H${xN}`, { x: xN, y: Y, dir: 'r' })}
      <Block x={xN} y={Y - 16} w={wN} h={32} title="N_r" ctrl />
      {wire('ff', `M${xN + wN} ${Y}H${xS - 11}`, { x: xS - 11, y: Y, dir: 'r' })}
      {probe('ff', (xN + wN + xS - 11) / 2, Y - 10, 'N_r·r')}
      <Sum x={xS} y={Y} signs="+−" />
      {wire('cv', `M${xS + 11} ${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
      {probe('cv', (xS + 11 + xV) / 2, Y - 10, 'u')}
      <Block x={xV} y={Y - 24} w={wV} h={48} title={proc.tags.valve} sub="actuator" />
      {wire('valve', `M${xV + wV} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      {firstDist && (
        <>
          {wire(`dist:${firstDist.key}`, `M${xP + wP / 2} ${Y - 58}V${Y - 24}`, { x: xP + wP / 2, y: Y - 24, dir: 'd' })}
          {probe(`dist:${firstDist.key}`, xP + wP / 2, Y - 64, `d: ${firstDist.label.toLowerCase()}`)}
        </>
      )}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 28, Y - 10, 'PV y')}
      {/* Measurements back to the observer */}
      {uses1 && wire('pv', `M${xOut - 18} ${Y}V${FB}H${xO + wO - 30}V${YO + 26}`, { x: xO + wO - 30, y: YO + 26, dir: 'u' })}
      {uses1 && probe('pv', xOut - 24, FB - 8, `${proc.tags.transmitter}`, 'end')}
      {uses2 && sec && (
        <>
          {wire('pv2', `M${xP + 20} ${Y + 24}V${YO - 42}H${xO + wO - 10}V${YO - 26}`, { x: xO + wO - 10, y: YO - 26, dir: 'd' })}
          {probe('pv2', xP + 26, YO - 48, `${sec.tag}: ${sec.label.toLowerCase()}`, 'start')}
        </>
      )}
      {/* The applied output into the observer too */}
      {wire(null, `M${xV - 18} ${Y}V${YO - 10}H${xO}`, { x: xO, y: YO - 10, dir: 'r' })}
      <Block x={xO} y={YO - 26} w={wO} h={52} title={config.observer === 'kalman' ? 'Kalman filter' : 'Observer'} sub="x̂′ = Ax̂ + Bu + L(y − Cx̂)" ctrl />
      {wire('P', `M${xO} ${YO + 10}H${xK + wK}`, { x: xK + wK, y: YO + 10, dir: 'l' })}
      {probe('pred', xO + wO / 2, YO + 44, 'estimate ŷ')}
      <text className="is-muted" x={xO - 8} y={YO + 4} textAnchor="end">x̂</text>
      <Block x={xK} y={YO - 6} w={wK} h={32} title="K" sub="every state" ctrl />
      {wire('P', `M${xK + wK / 2} ${YO - 6}V${Y + 52}H${xS}V${Y + 11}`, { x: xS, y: Y + 11, dir: 'u' })}
      {probe('P', xK + wK / 2 + 8, Y + 68, 'K·x̂', 'start')}
      {extra && (
        <>
          <Block x={xK - 40} y={YO + 52} w={116} h={30} title={extra} ctrl />
          {/* Added to K·x̂ on its way to the sum. */}
          {wire('I', `M${xK - 30} ${YO + 52}V${Y + 52}H${xK + wK / 2}`)}
          <circle className="ll-wire" cx={xK + wK / 2} cy={Y + 52} r={2.5} />
          {probe('I', xK + 80, YO + 72, config.integral === 'error' ? 'integral' : 'd̂ part', 'start')}
          {config.integral === 'dist' && <path className="ll-wire" strokeDasharray="4 3" d={`M${xO + 30} ${YO + 26}V${YO + 67}H${xK + 76}`} />}
        </>
      )}
    </svg>
  );
}

/**
 * A 2×2 process: two loops (each PID on its own valve, crossed if the pairing says so, with an optional
 * decoupler between them and the valves), or one MPC moving both. Inside the process each valve moves both.
 */
function MimoDiagram({ proc, config, probes, onProbe }: {
  proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'multiloop' | 'mpc' }>; probes: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  const sec = proc.secondary!, mimo = proc.mimo!;
  const Y1 = 75, Y2 = 215;
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
  const mpc = config.kind === 'mpc';
  const crossed = config.kind === 'multiloop' && config.pairing === 'crossed';
  const dec = config.kind === 'multiloop' && config.decouple;
  const xS = 80, xC = 122, wC = 126, xD = 296, wD = 88, xV = 434, wV = 96, xP = 580, wP = 136, xOut = xP + wP + 64;
  const firstDist = upsetList(proc)[0];
  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 20} 315`} role="img" aria-label={`Block diagram: ${mpc ? 'MPC' : crossed ? 'two loops, crossed pairing' : 'two loops'}${dec ? ' with a decoupler' : ''} on the ${proc.name.toLowerCase()}`}>
      {probe('sp', 10, Y1 - 10, 'SP r₁', 'start')}
      {probe('sp2', 10, Y2 - 10, 'SP r₂', 'start')}
      {mpc ? (
        <>
          {wire('sp', `M6 ${Y1}H${xC}`, { x: xC, y: Y1, dir: 'r' })}
          {wire('sp2', `M6 ${Y2}H${xC}`, { x: xC, y: Y2, dir: 'r' })}
          <Block x={xC} y={Y1 - 30} w={xD + wD - xC} h={Y2 - Y1 + 60} title="MPC" sub="model · plan M moves · limits" ctrl />
          <text className="is-muted" x={(xC + xD + wD) / 2} y={(Y1 + Y2) / 2 + 30} textAnchor="middle">Kalman filter: states, loads</text>
        </>
      ) : (
        <>
          {wire('sp', `M6 ${Y1}H${xS - 11}`, { x: xS - 11, y: Y1, dir: 'r' })}
          {wire('sp2', `M6 ${Y2}H${xS - 11}`, { x: xS - 11, y: Y2, dir: 'r' })}
          <Sum x={xS} y={Y1} signs="+−" />
          <Sum x={xS} y={Y2} signs="+−" />
          {wire(null, `M${xS + 11} ${Y1}H${xC}`, { x: xC, y: Y1, dir: 'r' })}
          {wire(null, `M${xS + 11} ${Y2}H${xC}`, { x: xC, y: Y2, dir: 'r' })}
          <Block x={xC} y={Y1 - 22} w={wC} h={44} title={`PID ${proc.tags.loop}`} sub={proc.pv.label.toLowerCase()} ctrl />
          <Block x={xC} y={Y2 - 22} w={wC} h={44} title={`PID ${mimo.loop2}`} sub={sec.label.toLowerCase()} ctrl />
          {probe('P', xC + wC / 2, Y1 + 36, 'P · I · D')}
          {dec ? (
            <>
              {wire(null, `M${xC + wC} ${Y1}H${xD}`, { x: xD, y: Y1, dir: 'r' })}
              {wire(null, `M${xC + wC} ${Y2}H${xD}`, { x: xD, y: Y2, dir: 'r' })}
              <Block x={xD} y={Y1 - 22} w={wD} h={Y2 - Y1 + 44} title="Decoupler" sub="static" ctrl />
              <text className="is-muted" x={xD + wD / 2} y={(Y1 + Y2) / 2 + 26} textAnchor="middle">u_a = w₁ + c_a w₂</text>
              <text className="is-muted" x={xD + wD / 2} y={(Y1 + Y2) / 2 + 40} textAnchor="middle">u_b = w₂ + c_b w₁</text>
            </>
          ) : crossed ? (
            <>
              <path className="ll-wire" d={`M${xC + wC} ${Y1}H${xD}L${xD + wD} ${Y2}`} />
              <path className="ll-wire" d={`M${xC + wC} ${Y2}H${xD}L${xD + wD} ${Y1}`} />
              <text className="is-muted" x={xD + wD / 2} y={(Y1 + Y2) / 2 - 8} textAnchor="middle">crossed</text>
            </>
          ) : (
            <>
              <path className="ll-wire" d={`M${xC + wC} ${Y1}H${xD + wD}`} />
              <path className="ll-wire" d={`M${xC + wC} ${Y2}H${xD + wD}`} />
            </>
          )}
        </>
      )}
      {wire('cv', `M${xD + wD} ${Y1}H${xV}`, { x: xV, y: Y1, dir: 'r' })}
      {wire('cv2', `M${xD + wD} ${Y2}H${xV}`, { x: xV, y: Y2, dir: 'r' })}
      {probe('cv', (xD + wD + xV) / 2, Y1 - 10, 'u₁')}
      {probe('cv2', (xD + wD + xV) / 2, Y2 - 10, 'u₂')}
      <Block x={xV} y={Y1 - 22} w={wV} h={44} title={proc.tags.valve} sub={proc.id === 'mixing' ? 'hot' : 'valve 1'} />
      <Block x={xV} y={Y2 - 22} w={wV} h={44} title={mimo.valve} sub={proc.id === 'mixing' ? 'cold' : 'valve 2'} />
      {wire('valve', `M${xV + wV} ${Y1}H${xP}`, { x: xP, y: Y1, dir: 'r' })}
      {wire('valve2', `M${xV + wV} ${Y2}H${xP}`, { x: xP, y: Y2, dir: 'r' })}
      <Block x={xP} y={Y1 - 30} w={wP} h={Y2 - Y1 + 60} title="Process" sub="each valve moves both" />
      <path className="ll-wire" strokeDasharray="3 3" d={`M${xP + 14} ${Y1 + 34}L${xP + wP - 14} ${Y2 - 34}M${xP + 14} ${Y2 - 34}L${xP + wP - 14} ${Y1 + 34}`} />
      {firstDist && (
        <>
          {wire(`dist:${firstDist.key}`, `M${xP + wP / 2} ${Y1 - 58}V${Y1 - 30}`, { x: xP + wP / 2, y: Y1 - 30, dir: 'd' })}
          {probe(`dist:${firstDist.key}`, xP + wP / 2, Y1 - 64, `d: ${firstDist.label.toLowerCase()}`)}
        </>
      )}
      {wire('pvTrue', `M${xP + wP} ${Y1}H${xOut}`, { x: xOut, y: Y1, dir: 'r' })}
      {wire('pv2True', `M${xP + wP} ${Y2}H${xOut}`, { x: xOut, y: Y2, dir: 'r' })}
      {probe('pvTrue', xP + wP + 26, Y1 - 10, `y₁ ${proc.pv.symbol}`)}
      {probe('pv2True', xP + wP + 26, Y2 - 10, `y₂ ${sec.symbol}`)}
      {/* Measurements back */}
      {wire('pv', `M${xOut - 16} ${Y1}V${Y1 + 42}H${mpc ? xC + 40 : xS}V${mpc ? Y1 + 30 : Y1 + 11}`, mpc ? undefined : { x: xS, y: Y1 + 11, dir: 'u' })}
      {wire('pv2', `M${xOut - 16} ${Y2}V${Y2 + 52}H${mpc ? xC + 40 : xS}V${mpc ? Y2 + 30 : Y2 + 11}`, mpc ? undefined : { x: xS, y: Y2 + 11, dir: 'u' })}
      {probe('pv', (xV + xP) / 2, Y1 + 36, proc.tags.transmitter)}
      {probe('pv2', (xV + xP) / 2, Y2 + 46, sec.tag)}
    </svg>
  );
}

/** Override: the normal and the limit controller in parallel, a selector, one valve. */
function OverrideDiagram({ proc, config, probes, onProbe }: {
  proc: ProcessDef; config: Extract<ControllerConfig, { kind: 'override' }>; probes: ProbeKey[]; onProbe?: (k: ProbeKey) => void;
}) {
  const sec = config.on === 'pv2' ? proc.secondary : undefined;
  const Y = 90, Y2 = 200, FB = 285;
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
  const s1 = 82, xC = 122, wC = 134, xSel = xC + wC + 56, wSel = 68;
  const xV = xSel + wSel + 56, wV = 96, xP = xV + wV + 58, wP = 116, xOut = xP + wP + 56;
  const selMid = (Y + Y2) / 2;
  const firstDist = upsetList(proc)[0];
  return (
    <svg className="ll-drawing" viewBox={`0 0 ${xOut + 20} 325`} role="img" aria-label={`Block diagram: override control of the ${proc.name.toLowerCase()}`}>
      {probe('sp', 12, Y - 10, 'SP r', 'start')}
      {wire('sp', `M8 ${Y}H${s1 - 11}`, { x: s1 - 11, y: Y, dir: 'r' })}
      <Sum x={s1} y={Y} signs="+−" />
      {wire(null, `M${s1 + 11} ${Y}H${xC}`, { x: xC, y: Y, dir: 'r' })}
      <Block x={xC} y={Y - 24} w={wC} h={48} title="Normal PID" sub={proc.tags.loop} ctrl />
      {probe('P', xC + 25, Y + 38, 'P')}
      {probe('I', xC + wC / 2, Y + 38, 'I')}
      {probe('D', xC + wC - 25, Y + 38, 'D')}
      {probe('sp', 12, Y2 - 10, `limit ${config.limit}`, 'start')}
      {wire(null, `M8 ${Y2}H${s1 - 11}`, { x: s1 - 11, y: Y2, dir: 'r' })}
      <Sum x={s1} y={Y2} signs="+−" />
      {wire(null, `M${s1 + 11} ${Y2}H${xC}`, { x: xC, y: Y2, dir: 'r' })}
      <Block x={xC} y={Y2 - 24} w={wC} h={48} title="Override PID" sub={`${sec ? sec.label.toLowerCase() : proc.pv.label.toLowerCase()} limit`} ctrl />
      {/* Both outputs into the selector */}
      {wire(null, `M${xC + wC} ${Y}H${xSel - 22}V${selMid - 10}H${xSel}`, { x: xSel, y: selMid - 10, dir: 'r' })}
      {wire('alt', `M${xC + wC} ${Y2}H${xSel - 22}V${selMid + 10}H${xSel}`, { x: xSel, y: selMid + 10, dir: 'r' })}
      {probe('alt', xC + wC + 8, Y2 - 10, 'override out', 'start')}
      <Block x={xSel} y={selMid - 28} w={wSel} h={56} title={config.select === 'max' ? 'MAX' : 'MIN'} sub="select" ctrl />
      {config.tracking && (
        <>
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xSel + wSel / 2} ${selMid - 28}V${Y - 40}H${xC + wC / 2}V${Y - 24}`} />
          <path className="ll-wire" strokeDasharray="4 3" d={`M${xSel + wSel / 2} ${selMid + 28}V${Y2 + 40}H${xC + wC / 2}V${Y2 + 24}`} />
          <text className="is-muted" x={xC + wC / 2 + 6} y={Y - 44}>external reset</text>
        </>
      )}
      {wire('cv', `M${xSel + wSel} ${selMid}H${xV - 24}V${Y}H${xV}`, { x: xV, y: Y, dir: 'r' })}
      {probe('cv', xSel + wSel + 6, selMid + 16, 'CV u', 'start')}
      <Block x={xV} y={Y - 24} w={wV} h={48} title="Valve" sub="1/(τᵥs + 1)" />
      {wire('valve', `M${xV + wV} ${Y}H${xP}`, { x: xP, y: Y, dir: 'r' })}
      {firstDist && (
        <>
          {wire(`dist:${firstDist.key}`, `M${xP + wP / 2} ${Y - 60}V${Y - 24}`, { x: xP + wP / 2, y: Y - 24, dir: 'd' })}
          {probe(`dist:${firstDist.key}`, xP + wP / 2, Y - 66, `d: ${firstDist.label.toLowerCase()}`)}
        </>
      )}
      <Block x={xP} y={Y - 24} w={wP} h={48} title="Process" sub={PROCESS_SUB[proc.id]} />
      {wire('pvTrue', `M${xP + wP} ${Y}H${xOut}`, { x: xOut, y: Y, dir: 'r' })}
      {probe('pvTrue', xP + wP + 24, Y - 10, 'PV y')}
      {/* Feedback: the main measurement to both (or the secondary to the override) */}
      {wire('pv', `M${xOut - 18} ${Y}V${FB}H${xP + wP}`, { x: xP + wP, y: FB, dir: 'l' })}
      <Block x={xP} y={FB - 20} w={wP} h={40} title={proc.tags.transmitter} sub="e^(−θs)/(τₘs + 1)" />
      {wire('pv', `M${xP} ${FB}H32V${Y + 30}H${s1}V${Y + 11}`, { x: s1, y: Y + 11, dir: 'u' })}
      {probe('pv', (xC + xP) / 2, FB - 8, 'PV measured')}
      {sec ? (
        <>
          {wire('pv2', `M${xV + wV + 24} ${Y}V${Y2 + 52}H${s1}V${Y2 + 11}`, { x: s1, y: Y2 + 11, dir: 'u' })}
          {probe('pv2', xV + wV + 30, Y2 + 46, `${sec.tag} measured`, 'start')}
        </>
      ) : wire(null, `M32 ${Y2 + 30}H${s1}V${Y2 + 11}`, { x: s1, y: Y2 + 11, dir: 'u' })}
    </svg>
  );
}
