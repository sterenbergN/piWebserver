'use client';

import type { ControllerConfig } from '@/lib/loop-lab/controllers';
import { valveCharacteristic, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { flowAt } from '@/lib/loop-lab/processes/flow';
import { steamFlow } from '@/lib/loop-lab/processes/hx';
import { Bubble, ControlValve, f1, FlowSchematic, flowAnim, PAndId, TankSchematic } from './Drawings';

// Process drawings for the stirred tank, the heat exchanger and an identified
// plant, one entry point that draws any process from its state, and P&IDs that
// follow the control structure (cascade adds the flow loop, feedforward the
// measured disturbances).

/** Liquid colour from cold (blue) to hot (red) over 0–100 °C. */
function heat(T: number) {
  const f = Math.min(1, Math.max(0, T / 100));
  const mix = (a: number, b: number) => Math.round(a + f * (b - a));
  return `rgba(${mix(79, 224)}, ${mix(143, 112)}, ${mix(214, 122)}, 0.45)`;
}

export function StirredSchematic({ p, d, valve, Tj, T }: { p: Params; d: Params; valve: number; Tj: number; T: number }) {
  const q = p.Qmax * valveCharacteristic(p.valveChar, valve / 100);
  return (
    <svg className="ll-drawing" viewBox="0 0 520 300" role="img" aria-label={`Stirred tank at ${T.toFixed(1)} °C`}>
      {/* Jacket and vessel */}
      <path d="M150 70V220Q150 262 260 262Q370 262 370 220V70" fill={heat(Tj)} stroke="var(--ll-steel)" strokeWidth={3} />
      <path d="M170 70V215Q170 244 260 244Q350 244 350 215V70" fill={heat(T)} stroke="var(--ll-steel)" strokeWidth={3} />
      <line className="ll-steel" x1={140} x2={380} y1={70} y2={70} />
      {/* Agitator */}
      <line className="ll-line" x1={260} y1={30} x2={260} y2={200} />
      <rect className="ll-block" x={244} y={14} width={32} height={18} rx={3} />
      <text x={260} y={27} textAnchor="middle">M</text>
      <path className="ll-line" d="M236 200H284M236 192V208M284 192V208" />
      <text x={260} y={150} textAnchor="middle" fontWeight={700}>{T.toFixed(1)} °C</text>
      <text className="is-muted" x={385} y={236}>jacket {Tj.toFixed(1)} °C</text>
      {/* Feed in, product out */}
      <path className="ll-pipe" d="M20 50H200V75" />
      <path className="ll-flowline" style={flowAnim(d.F)} d="M24 50H200V72" />
      <text x={20} y={40}>Feed {f1(d.F)} m³/h at {f1(d.Tin)} °C</text>
      <path className="ll-pipe" d="M260 244V285H500" />
      <path className="ll-flowline" style={flowAnim(d.F)} d="M260 248V285H496" />
      {/* Heating */}
      <path className="ll-pipe" d="M20 130H150" />
      <ControlValve x={80} y={130} open={valve} tag="TV-401" label={false} />
      <text x={20} y={165}>TV-401 {f1(valve)} %</text>
      <text className="is-muted" x={20} y={180}>{f1(q)} kW to the jacket</text>
      {/* Thermowell */}
      <line className="ll-signal" x1={330} y1={120} x2={430} y2={120} />
      <circle className="ll-bubble" cx={450} cy={120} r={18} />
      <text x={450} y={116} textAnchor="middle">TT</text>
      <text x={450} y={129} textAnchor="middle">401</text>
    </svg>
  );
}

export function HxSchematic({ p, d, valve, T, Tw }: { p: Params; d: Params; valve: number; T: number; Tw: number }) {
  const ms = steamFlow(valveCharacteristic(p.valveChar, valve / 100), d.Ps, p);
  return (
    <svg className="ll-drawing" viewBox="0 0 600 270" role="img" aria-label={`Heat exchanger: outlet ${T.toFixed(1)} °C, steam ${Math.round(ms)} kg/h`}>
      {/* Shell with tubes */}
      <rect x={180} y={120} width={240} height={80} rx={30} fill={heat(Tw)} stroke="var(--ll-steel)" strokeWidth={3} />
      {[138, 152, 166, 180].map((y) => <line key={y} className="ll-steel" x1={190} x2={410} y1={y} y2={y} />)}
      <text className="is-muted" x={300} y={214} textAnchor="middle">tubes {Tw.toFixed(1)} °C</text>
      {/* Steam in, condensate out */}
      <path className="ll-pipe" d="M20 60H300V120" />
      {ms > 1 && <path className="ll-flowline" style={flowAnim(ms / 800)} d="M24 60H300V116" />}
      <text x={20} y={46}>Steam {f1(d.Ps)} bar</text>
      <ControlValve x={110} y={60} open={valve} tag="FV-301" label={false} />
      <text x={86} y={96}>FV-301 {f1(valve)} %</text>
      <circle className="ll-block" cx={210} cy={60} r={12} />
      <text x={210} y={64} textAnchor="middle">F</text>
      <text x={190} y={36}>FT-301 {Math.round(ms)} kg/h</text>
      <path className="ll-pipe" d="M300 200V250H360" />
      <text className="is-muted" x={368} y={254}>condensate</text>
      {/* Process side */}
      <path className="ll-pipe" d="M20 160H180" />
      <path className="ll-flowline" style={flowAnim(d.F / 10)} d="M24 160H176" />
      <text x={20} y={150}>{f1(d.F)} m³/h at {f1(d.Tin)} °C</text>
      <text className="is-muted" x={20} y={186}>FT-302 · TT-302</text>
      <path className="ll-pipe" d="M420 160H590" />
      <path className="ll-flowline" style={flowAnim(d.F / 10)} d="M424 160H586" />
      <line className="ll-signal" x1={520} y1={160} x2={520} y2={110} />
      <circle className="ll-bubble" cx={520} cy={92} r={18} />
      <text x={520} y={88} textAnchor="middle">TT</text>
      <text x={520} y={101} textAnchor="middle">301</text>
      <text x={455} y={186} fontWeight={700}>{T.toFixed(1)} °C out</text>
      <text className="is-muted" x={455} y={202}>read {f1(p.txDelay)} s downstream</text>
    </svg>
  );
}

export function GenericSchematic({ proc, p, valve, pv }: { proc: ProcessDef; p: Params; valve: number; pv: number }) {
  const model = p.integrating
    ? `k′ = ${(p.K / p.tau1).toPrecision(3)} %/s per %, θ = ${f1(p.txDelay)} s`
    : `K = ${p.K.toPrecision(3)}, τ = ${f1(p.tau1)}${p.tau2 > 0 ? ` + ${f1(p.tau2)}` : ''} s, θ = ${f1(p.txDelay)} s`;
  return (
    <svg className="ll-drawing" viewBox="0 0 560 170" role="img" aria-label={`Identified plant: output ${f1(valve)} %, PV ${f1(pv)} %`}>
      <path className="ll-pipe" d="M20 106H540" />
      <ControlValve x={110} y={106} open={valve} tag={proc.tags.valve} />
      <rect className="ll-block is-ctrl" x={210} y={76} width={200} height={60} rx={6} />
      <text x={310} y={100} textAnchor="middle" fontWeight={700}>Identified model</text>
      <text className="is-muted" x={310} y={118} textAnchor="middle">{model}</text>
      <line className="ll-signal" x1={470} y1={106} x2={470} y2={58} />
      <circle className="ll-bubble" cx={470} cy={40} r={18} />
      <text x={470} y={36} textAnchor="middle">XT</text>
      <text x={470} y={49} textAnchor="middle">100</text>
      <text x={430} y={150} fontWeight={700}>{f1(pv)} %</text>
    </svg>
  );
}

/** Draw any process from its full state vector [valve, ...process states, reading(s)]. */
export function ProcessDrawing({ proc, p, d, x }: { proc: ProcessDef; p: Params; d: Params; x: number[] }) {
  const valve = x[0];
  const flow = valveCharacteristic(p.valveChar, valve / 100);
  if (proc.id === 'flow') return <FlowSchematic p={p} valve={valve} flow={flowAt(flow, d.P0, p)} P0={d.P0} />;
  if (proc.id === 'tank') {
    const h = x[1];
    return <TankSchematic p={p} level={h} valve={valve} dOut={d.dOut} qIn={p.Qmax * flow * (d.supply / 100)} qOut={p.Kout * (d.dOut / 100) * Math.sqrt(Math.max(0, h))} />;
  }
  if (proc.id === 'stirred') return <StirredSchematic p={p} d={d} valve={valve} Tj={x[1]} T={x[2]} />;
  if (proc.id === 'hx') return <HxSchematic p={p} d={d} valve={valve} Tw={x[1]} T={x[2]} />;
  return <GenericSchematic proc={proc} p={p} valve={valve} pv={proc.pvOf(x.slice(1, 1 + proc.states.length), flow, d, p)} />;
}

const LEGEND = 'Dashed: electrical signal · circle in a square: a function in the PLC, shown on the HMI';

/** The P&ID for a process, drawn for the controller in use. */
export function PAndIdFor({ proc, config }: { proc: ProcessDef; config: ControllerConfig }) {
  if (proc.id === 'flow' || proc.id === 'tank') return <PAndId proc={proc} />;
  if (proc.id === 'stirred') {
    return (
      <svg className="ll-drawing" viewBox="0 0 520 300" role="img" aria-label="P&ID of the vessel temperature loop">
        <path className="ll-steel" strokeWidth={2.5} d="M160 70V215Q160 250 260 250Q360 250 360 215V70Z" />
        <path className="ll-steel" strokeWidth={1.5} d="M175 85V210Q175 236 260 236Q345 236 345 210V85" />
        <text className="is-muted" x={260} y={160} textAnchor="middle">R-401</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 140H160" />
        <ControlValve x={80} y={140} open={50} tag="" label={false} />
        <text x={58} y={172}>TV-401</text>
        <line className="ll-signal" x1={350} y1={140} x2={410} y2={140} />
        <Bubble x={430} y={140} letters="TT" num="401" />
        <line className="ll-signal" x1={430} y1={120} x2={430} y2={70} />
        <Bubble x={430} y={50} letters="TIC" num="401" shared />
        <path className="ll-signal" d="M410 50H80V98" />
        <text className="is-muted" x={20} y={292}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'hx') {
    const cascade = config.kind === 'cascade';
    const ff = config.kind === 'feedforward' || config.kind === 'cascade' ? config.ff : [];
    return (
      <svg className="ll-drawing" viewBox="0 0 600 340" role="img" aria-label={`P&ID of the heat exchanger${cascade ? ', temperature cascaded to steam flow' : ''}${ff.length ? ', with feedforward' : ''}`}>
        <rect className="ll-steel" strokeWidth={2.5} x={230} y={190} width={200} height={70} rx={26} />
        <text className="is-muted" x={330} y={230} textAnchor="middle">E-301</text>
        {/* Steam line */}
        <path className="ll-pipe" strokeWidth={3} d="M20 140H330V190" />
        <ControlValve x={130} y={140} open={50} tag="" label={false} />
        <text x={110} y={172}>FV-301</text>
        <circle className="ll-block" cx={240} cy={140} r={11} />
        {/* Process line */}
        <path className="ll-pipe" strokeWidth={3} d="M20 225H230M430 225H590" />
        <circle className="ll-block" cx={80} cy={225} r={11} />
        <line className="ll-signal" x1={520} y1={225} x2={520} y2={190} />
        <Bubble x={520} y={170} letters="TT" num="301" />
        <line className="ll-signal" x1={520} y1={150} x2={520} y2={60} />
        <Bubble x={520} y={40} letters="TIC" num="301" shared />
        {cascade ? (
          <>
            <line className="ll-signal" x1={240} y1={129} x2={240} y2={110} />
            <Bubble x={240} y={90} letters="FT" num="301" />
            <line className="ll-signal" x1={260} y1={90} x2={300} y2={90} />
            <Bubble x={320} y={90} letters="FIC" num="301" shared />
            <path className="ll-signal" d="M500 40H320V70" />
            <path className="ll-signal" d="M300 90H290V60H130V98" strokeDasharray="5 3" />
            <text className="is-muted" x={330} y={34}>setpoint</text>
          </>
        ) : <path className="ll-signal" d="M500 40H130V98" />}
        {ff.length > 0 && (
          <>
            <line className="ll-signal" x1={80} y1={236} x2={80} y2={280} />
            <Bubble x={80} y={300} letters={ff.length > 1 ? 'FT/TT' : ff[0].from === 'F' ? 'FT' : 'TT'} num="302" />
            <path className="ll-signal" d="M100 300H400V40" />
            <Bubble x={400} y={300} letters="FY" num="302" shared />
            <text className="is-muted" x={428} y={296}>feedforward</text>
            <text className="is-muted" x={428} y={310}>into {cascade ? 'FIC-301 setpoint' : 'TIC-301 output'}</text>
          </>
        )}
        <text className="is-muted" x={20} y={334}>{LEGEND}</text>
      </svg>
    );
  }
  return (
    <svg className="ll-drawing" viewBox="0 0 520 220" role="img" aria-label="P&ID of the identified loop">
      <path className="ll-pipe" strokeWidth={3} d="M20 150H500" />
      <ControlValve x={170} y={150} open={50} tag="" label={false} />
      <text x={150} y={190}>{proc.tags.valve}</text>
      <rect className="ll-block" x={290} y={130} width={80} height={40} rx={4} />
      <text x={330} y={154} textAnchor="middle">process</text>
      <line className="ll-signal" x1={420} y1={150} x2={420} y2={100} />
      <Bubble x={420} y={80} letters="XT" num="100" />
      <line className="ll-signal" x1={400} y1={80} x2={270} y2={80} />
      <line className="ll-signal" x1={270} y1={80} x2={270} y2={50} />
      <Bubble x={250} y={30} letters="XIC" num="100" shared />
      <path className="ll-signal" d="M230 30H170V103" />
      <text className="is-muted" x={20} y={212}>{LEGEND}</text>
    </svg>
  );
}
