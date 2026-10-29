'use client';

import { useId } from 'react';
import type { ControllerConfig } from '@/lib/loop-lab/controllers';
import { valveCharacteristic, type Params, type ProcessDef } from '@/lib/loop-lab/model';
import { flowAt } from '@/lib/loop-lab/processes/flow';
import { steamFlow } from '@/lib/loop-lab/processes/hx';
import { splitValves } from '@/lib/loop-lab/processes/jacket';
import { Bubble, ControlValve, f1, FlowSchematic, flowAnim, PAndId, TankSchematic } from './Drawings';

// Process drawings for the stirred tank, the heat exchanger, the surge tank,
// the belt feeder, the boiler drum and an identified plant; one entry point
// that draws any process from its state; and P&IDs that follow the control
// structure (cascade adds the flow loop, feedforward the measured
// disturbances, a Smith predictor its model).

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

export function SurgeSchematic({ p, level, valve, qIn }: { p: Params; level: number; valve: number; qIn: number }) {
  const qOut = p.Qmax * valveCharacteristic(p.valveChar, valve / 100);
  const top = 40, bottom = 230, x0 = 160, x1 = 340;
  const yl = bottom - (Math.min(Math.max(level, 0), p.H) / p.H) * (bottom - top);
  return (
    <svg className="ll-drawing" viewBox="0 0 560 290" role="img" aria-label={`Surge tank: level ${level.toFixed(2)} m, ${f1(qIn)} m³/h in, ${f1(qOut)} m³/h out`}>
      <rect className="ll-liquid" x={x0} y={yl} width={x1 - x0} height={bottom - yl} />
      <path className="ll-steel" strokeWidth={3} d={`M${x0} ${top}V${bottom}H${x1}V${top}`} />
      <line className="ll-guide" x1={x0 - 6} x2={x1 + 6} y1={yl} y2={yl} />
      <text x={(x0 + x1) / 2} y={Math.min(bottom - 6, yl + 18)} textAnchor="middle" fontWeight={700}>{level.toFixed(2)} m</text>
      <text className="is-muted" x={(x0 + x1) / 2} y={bottom + 18} textAnchor="middle">T-601 · A = {f1(p.A)} m²</text>
      {/* Inflow from upstream */}
      <path className="ll-pipe" d={`M20 24H${x0 + 30}V${top + 6}`} />
      {qIn > 0.1 && <path className="ll-flowline" style={flowAnim(qIn / 30)} d={`M24 24H${x0 + 30}V${top + 2}`} />}
      <text x={20} y={14}>From upstream · {f1(qIn)} m³/h</text>
      {/* Pumped outlet */}
      <path className="ll-pipe" d={`M${x1 - 30} ${bottom}V${bottom + 30}H540`} />
      {qOut > 0.1 && <path className="ll-flowline" style={flowAnim(qOut / 30)} d={`M${x1 - 30} ${bottom + 4}V${bottom + 30}H536`} />}
      <circle className="ll-block" cx={390} cy={bottom + 30} r={14} />
      <path className="ll-line" d={`M383 ${bottom + 21}L399 ${bottom + 30}L383 ${bottom + 39}`} />
      <text className="is-muted" x={376} y={bottom + 58}>P-601</text>
      <ControlValve x={470} y={bottom + 30} open={valve} tag="" label={false} />
      <text x={440} y={bottom - 30}>LV-601</text>
      <text className="is-muted" x={440} y={bottom - 16}>{f1(valve)} % · {f1(qOut)} m³/h out</text>
      {/* Level transmitter */}
      <line className="ll-signal" x1={x1} y1={130} x2={x1 + 50} y2={130} />
      <circle className="ll-bubble" cx={x1 + 68} cy={130} r={18} />
      <text x={x1 + 68} y={126} textAnchor="middle">LT</text>
      <text x={x1 + 68} y={139} textAnchor="middle">601</text>
    </svg>
  );
}

export function FeederSchematic({ p, d, speed, atScrew, reading }: { p: Params; d: Params; speed: number; atScrew: number; reading: number }) {
  const beltY = 170;
  return (
    <svg className="ll-drawing" viewBox="0 0 600 250" role="img" aria-label={`Belt feeder: screw at ${f1(speed)} %, ${f1(atScrew)} t/h leaving the screw`}>
      {/* Hopper and screw */}
      <path className="ll-steel" strokeWidth={3} d="M40 20H160L120 90H80Z" />
      <path className="ll-solid" d="M48 30H152L118 86H82Z" />
      <text className="is-muted" x={100} y={14} textAnchor="middle">hopper · {f1(d.density)} % density</text>
      <rect className="ll-block" x={70} y={90} width={150} height={26} rx={4} />
      <path className="ll-line" d="M80 103Q90 93 100 103T120 103T140 103T160 103T180 103T200 103" />
      <rect className="ll-block" x={20} y={92} width={40} height={22} rx={3} />
      <text x={40} y={107} textAnchor="middle">M</text>
      <text x={20} y={140}>SC-701 {f1(speed)} %</text>
      {/* Discharge onto the belt */}
      <path className="ll-solid" d="M205 116H220L216 162H209Z" />
      <text x={230} y={112}>{f1(atScrew)} t/h</text>
      {/* Belt */}
      <circle className="ll-block" cx={200} cy={beltY + 10} r={10} />
      <circle className="ll-block" cx={560} cy={beltY + 10} r={10} />
      <path className="ll-steel" strokeWidth={2} d={`M200 ${beltY}H560M200 ${beltY + 20}H560`} />
      {atScrew > 0.1 && <path className="ll-flowline" style={flowAnim(0.5)} d={`M212 ${beltY - 3}H548`} />}
      <text className="is-muted" x={330} y={beltY + 42} textAnchor="middle">belt: {f1(p.txDelay)} s from screw to scale</text>
      {/* Weigh idler */}
      <path className="ll-line" d={`M470 ${beltY + 20}V${beltY + 34}M458 ${beltY + 34}H482`} />
      <line className="ll-signal" x1={470} y1={beltY} x2={470} y2={100} />
      <circle className="ll-bubble" cx={470} cy={82} r={18} />
      <text x={470} y={78} textAnchor="middle">WT</text>
      <text x={470} y={91} textAnchor="middle">701</text>
      <text x={500} y={70} fontWeight={700}>{f1(reading)} t/h</text>
      <text className="is-muted" x={500} y={86}>on the scale</text>
      <path className="ll-line" d={`M560 ${beltY}L585 ${beltY + 40}`} />
      <text className="is-muted" x={585} y={beltY + 56} textAnchor="end">to the kiln</text>
    </svg>
  );
}

export function DrumSchematic({ p, d, valve, level, swell }: { p: Params; d: Params; valve: number; level: number; swell: number }) {
  const qfw = p.Qmax * valveCharacteristic(p.valveChar, valve / 100) * (d.Pfw / 100);
  const cy = 120, half = 60, x0 = 170, x1 = 430;
  const yl = cy - (Math.min(Math.max(level, -300), 300) / 300) * half * 0.9;
  const bubbles = Math.max(0, Math.min(14, Math.round(swell / 15)));
  const clip = `ll-drum-${useId().replace(/:/g, '')}`;
  return (
    <svg className="ll-drawing" viewBox="0 0 600 280" role="img" aria-label={`Boiler drum: level ${Math.round(level)} mm, steam ${f1(d.qs)} t/h, feedwater ${f1(qfw)} t/h`}>
      <clipPath id={clip}><rect x={x0} y={cy - half} width={x1 - x0} height={2 * half} rx={half} /></clipPath>
      <rect className="ll-liquid" x={x0} y={yl} width={x1 - x0} height={cy + half - yl} clipPath={`url(#${clip})`} />
      {Array.from({ length: bubbles }, (_, i) => (
        <circle key={i} className="ll-bubble-gas" cx={x0 + 40 + ((i * 53) % (x1 - x0 - 80))} cy={Math.min(cy + half - 10, yl + 12 + ((i * 17) % 40))} r={3} />
      ))}
      <rect className="ll-steel" fill="none" strokeWidth={3} x={x0} y={cy - half} width={x1 - x0} height={2 * half} rx={half} />
      <line className="ll-guide" x1={x0 + 20} x2={x1 - 20} y1={cy} y2={cy} strokeDasharray="6 4" />
      <text className="is-muted" x={x1 - 24} y={cy - 4} textAnchor="end">NWL</text>
      <text x={(x0 + x1) / 2} y={Math.min(cy + half - 8, yl + 18)} textAnchor="middle" fontWeight={700}>{level >= 0 ? '+' : ''}{Math.round(level)} mm</text>
      {/* Steam out */}
      <path className="ll-pipe" d={`M${x1 - 60} ${cy - half}V24H580`} />
      <path className="ll-flowline" style={flowAnim(d.qs / 40)} d={`M${x1 - 60} ${cy - half - 4}V24H576`} />
      <circle className="ll-block" cx={500} cy={24} r={11} />
      <text x={470} y={52}>FT-503 · steam {f1(d.qs)} t/h</text>
      {/* Feedwater in */}
      <path className="ll-pipe" d={`M20 230H${x0 + 50}V${cy + half}`} />
      {qfw > 0.5 && <path className="ll-flowline" style={flowAnim(qfw / 40)} d={`M24 230H${x0 + 50}V${cy + half + 4}`} />}
      <ControlValve x={70} y={230} open={valve} tag="" label={false} />
      <text x={20} y={268}>FV-502 {f1(valve)} % · feedwater {f1(qfw)} t/h</text>
      <circle className="ll-block" cx={150} cy={230} r={11} />
      <text x={136} y={212}>FT-502</text>
      <text className="is-muted" x={20} y={172}>{f1(d.Pfw)} % header pressure</text>
      {/* Downcomer and risers to the furnace */}
      <path className="ll-pipe" d={`M${x1 - 90} ${cy + half}V250M${x1 - 40} ${cy + half - 6}V250`} />
      <text className="is-muted" x={x1 - 65} y={268} textAnchor="middle">to and from the furnace</text>
      {/* Level transmitter */}
      <line className="ll-signal" x1={x1} y1={cy} x2={x1 + 50} y2={cy} />
      <circle className="ll-bubble" cx={x1 + 68} cy={cy} r={18} />
      <text x={x1 + 68} y={cy - 4} textAnchor="middle">LT</text>
      <text x={x1 + 68} y={cy + 9} textAnchor="middle">501</text>
    </svg>
  );
}

export function JacketSchematic({ p, d, signal, Tj, T }: { p: Params; d: Params; signal: number; Tj: number; T: number }) {
  const { cool, heat: hot } = splitValves(signal / 100, p);
  const qh = p.Qhmax * hot, qc = p.Kcw * cool * Math.max(0, Tj - d.Tcw);
  return (
    <svg className="ll-drawing" viewBox="0 0 560 300" role="img" aria-label={`Reactor at ${T.toFixed(1)} °C: steam ${Math.round(hot * 100)} % open, cooling water ${Math.round(cool * 100)} % open`}>
      <path d="M180 60V215Q180 262 290 262Q400 262 400 215V60" fill={heat(Tj)} stroke="var(--ll-steel)" strokeWidth={3} />
      <path d="M200 60V210Q200 244 290 244Q380 244 380 210V60" fill={heat(T)} stroke="var(--ll-steel)" strokeWidth={3} />
      <line className="ll-steel" x1={170} x2={410} y1={60} y2={60} />
      <line className="ll-line" x1={290} y1={22} x2={290} y2={200} />
      <rect className="ll-block" x={274} y={8} width={32} height={18} rx={3} />
      <text x={290} y={21} textAnchor="middle">M</text>
      <path className="ll-line" d="M266 200H314M266 192V208M314 192V208" />
      <text x={290} y={145} textAnchor="middle" fontWeight={700}>{T.toFixed(1)} °C</text>
      <text className="is-muted" x={290} y={162} textAnchor="middle">reaction {f1(d.Qr)} kW</text>
      <text className="is-muted" x={410} y={250}>jacket {Tj.toFixed(1)} °C</text>
      {/* Steam, high range */}
      <path className="ll-pipe" d="M20 100H180" />
      {hot > 0.005 && <path className="ll-flowline" style={flowAnim(hot * 2)} d="M24 100H176" />}
      <ControlValve x={90} y={100} open={hot * 100} tag="" label={false} />
      <text x={20} y={46}>Steam TV-501B {f1(hot * 100)} % · {f1(qh)} kW</text>
      {/* Cooling water, low range */}
      <path className="ll-pipe" d="M20 190H180" />
      {cool > 0.005 && <path className="ll-flowline" style={flowAnim(cool * 2)} d="M24 190H176" />}
      <ControlValve x={90} y={190} open={cool * 100} tag="" label={false} />
      <text x={20} y={222}>Cooling water TV-501A {f1(cool * 100)} %</text>
      <text className="is-muted" x={20} y={236}>{f1(d.Tcw)} °C supply · {f1(qc)} kW out</text>
      <path className="ll-pipe" d="M400 90H470" />
      <text className="is-muted" x={476} y={94}>return</text>
      {/* Temperature */}
      <line className="ll-signal" x1={370} y1={130} x2={470} y2={130} />
      <circle className="ll-bubble" cx={490} cy={130} r={18} />
      <text x={490} y={126} textAnchor="middle">TT</text>
      <text x={490} y={139} textAnchor="middle">501</text>
      <text className="is-muted" x={20} y={290}>TY-501 at {f1(signal)} %: split at {f1(p.split)} %{p.gap > 0 ? `, gap ${f1(p.gap)} %` : ''}</text>
    </svg>
  );
}

export function BlendSchematic({ p, d, valve, c, reading }: { p: Params; d: Params; valve: number; c: number; reading: number }) {
  const FB = p.FBmax * valveCharacteristic(p.valveChar, valve / 100) * (d.Pb / 100);
  return (
    <svg className="ll-drawing" viewBox="0 0 600 250" role="img" aria-label={`Blending: ${f1(d.FA)} m³/h diluent, ${f1(FB)} m³/h concentrate, product ${c.toFixed(2)} %`}>
      {/* Diluent (wild) */}
      <path className="ll-pipe" d="M20 90H250" />
      <path className="ll-flowline" style={flowAnim(d.FA / 30)} d="M24 90H246" />
      <circle className="ll-block" cx={90} cy={90} r={11} />
      <text x={20} y={66}>Diluent (wild) {f1(d.FA)} m³/h</text>
      <text className="is-muted" x={78} y={120}>FT-801</text>
      {/* Concentrate */}
      <path className="ll-pipe" d="M20 190H210V110H250" />
      {FB > 0.05 && <path className="ll-flowline" style={flowAnim(FB / 10)} d="M24 190H210V110H246" />}
      <ControlValve x={80} y={190} open={valve} tag="" label={false} />
      <circle className="ll-block" cx={160} cy={190} r={11} />
      <text x={20} y={226}>Concentrate {f1(d.cB)} % · FV-802 {f1(valve)} % · FT-802 {f1(FB)} m³/h</text>
      {/* Mixer */}
      <rect className="ll-block" x={250} y={74} width={110} height={52} rx={8} />
      <path className="ll-line" d="M262 100L278 84L294 116L310 84L326 116L342 84L352 96" />
      <text className="is-muted" x={305} y={142} textAnchor="middle">static mixer</text>
      {/* Product and analyzer */}
      <path className="ll-pipe" d="M360 100H590" />
      <path className="ll-flowline" style={flowAnim((d.FA + FB) / 30)} d="M364 100H586" />
      <text x={380} y={86} fontWeight={700}>{c.toFixed(2)} % product</text>
      <path className="ll-line" strokeDasharray="2 3" d="M500 100V160H530" />
      <circle className="ll-bubble" cx={548} cy={160} r={18} />
      <text x={548} y={156} textAnchor="middle">AT</text>
      <text x={548} y={169} textAnchor="middle">803</text>
      <text className="is-muted" x={420} y={196}>sample line {f1(p.txDelay)} s · reads {reading.toFixed(2)} %</text>
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
  if (proc.id === 'surge') return <SurgeSchematic p={p} level={x[1]} valve={valve} qIn={d.Qin} />;
  if (proc.id === 'feeder') return <FeederSchematic p={p} d={d} speed={valve} atScrew={x[1]} reading={x[2]} />;
  if (proc.id === 'jacket') return <JacketSchematic p={p} d={d} signal={valve} Tj={x[1]} T={x[2]} />;
  if (proc.id === 'blend') return <BlendSchematic p={p} d={d} valve={valve} c={x[1]} reading={x[2]} />;
  if (proc.id === 'drum') return <DrumSchematic p={p} d={d} valve={valve} level={x[1] + x[2] - x[3]} swell={x[2]} />;
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
  if (proc.id === 'hx' && config.kind === 'override') {
    const onFlow = config.on === 'pv2';
    return (
      <svg className="ll-drawing" viewBox="0 0 600 300" role="img" aria-label={`P&ID of the heat exchanger with a ${onFlow ? 'steam flow' : 'temperature'} override`}>
        <rect className="ll-steel" strokeWidth={2.5} x={230} y={190} width={200} height={70} rx={26} />
        <text className="is-muted" x={330} y={230} textAnchor="middle">E-301</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 140H330V190" />
        <ControlValve x={130} y={140} open={50} tag="" label={false} />
        <text x={110} y={172}>FV-301</text>
        <circle className="ll-block" cx={240} cy={140} r={11} />
        <path className="ll-pipe" strokeWidth={3} d="M20 225H230M430 225H590" />
        <line className="ll-signal" x1={520} y1={225} x2={520} y2={190} />
        <Bubble x={520} y={170} letters="TT" num="301" />
        <line className="ll-signal" x1={520} y1={150} x2={520} y2={60} />
        <Bubble x={520} y={40} letters="TIC" num="301" shared />
        {onFlow && (
          <>
            <line className="ll-signal" x1={240} y1={129} x2={240} y2={110} />
            <Bubble x={240} y={90} letters="FT" num="301" />
            <line className="ll-signal" x1={260} y1={90} x2={300} y2={90} />
            <Bubble x={320} y={90} letters="FIC" num="301" shared />
            <text className="is-muted" x={300} y={124}>limit {config.limit} kg/h</text>
          </>
        )}
        <Bubble x={410} y={40} letters={config.select === 'max' ? 'TY >' : 'TY <'} num="301" shared />
        <path className="ll-signal" d="M500 40H430" />
        {onFlow ? <path className="ll-signal" d="M340 90H410V60" /> : null}
        <path className="ll-signal" d="M390 40H130V98" />
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
  if (proc.id === 'surge' && config.kind === 'override') {
    return (
      <svg className="ll-drawing" viewBox="0 0 560 300" role="img" aria-label="P&ID of the surge tank level loop with a high-level override">
        <path className="ll-steel" strokeWidth={2.5} d="M160 70V230H320V70Z" />
        <text className="is-muted" x={240} y={160} textAnchor="middle">T-601</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 50H200V70" />
        <text className="is-muted" x={20} y={40}>from upstream</text>
        <path className="ll-pipe" strokeWidth={3} d="M290 230V260H540" />
        <circle className="ll-block" cx={350} cy={260} r={12} />
        <text className="is-muted" x={338} y={288}>P-601</text>
        <ControlValve x={480} y={260} open={50} tag="" label={false} />
        <text x={496} y={230}>{proc.tags.valve}</text>
        <line className="ll-signal" x1={320} y1={130} x2={350} y2={130} />
        <Bubble x={370} y={130} letters="LT" num="601" />
        <path className="ll-signal" d="M390 130H410V60H430M410 130V160H430" />
        <Bubble x={450} y={60} letters="LIC" num="601" shared />
        <Bubble x={450} y={160} letters="LIC" num="602" shared />
        <text className="is-muted" x={476} y={174}>high limit</text>
        <path className="ll-signal" d="M470 60H510V100M470 160H510V140" />
        <Bubble x={510} y={120} letters={config.select === 'max' ? 'LY >' : 'LY <'} num="601" shared />
        <path className="ll-signal" d="M530 120H545V200H480V218" />
        <text className="is-muted" x={20} y={292}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'surge') {
    return (
      <svg className="ll-drawing" viewBox="0 0 520 300" role="img" aria-label="P&ID of the surge tank level loop">
        <path className="ll-steel" strokeWidth={2.5} d="M160 70V230H320V70Z" />
        <text className="is-muted" x={240} y={160} textAnchor="middle">T-601</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 50H200V70" />
        <text className="is-muted" x={20} y={40}>from upstream</text>
        <path className="ll-pipe" strokeWidth={3} d="M290 230V260H500" />
        <circle className="ll-block" cx={350} cy={260} r={12} />
        <text className="is-muted" x={338} y={288}>P-601</text>
        <ControlValve x={430} y={260} open={50} tag="" label={false} />
        <text x={450} y={230}>{proc.tags.valve}</text>
        <line className="ll-signal" x1={320} y1={130} x2={410} y2={130} />
        <Bubble x={430} y={130} letters="LT" num="601" />
        <line className="ll-signal" x1={430} y1={110} x2={430} y2={80} />
        <Bubble x={430} y={60} letters="LIC" num="601" shared />
        <path className="ll-signal" d="M450 60H490V200H430V218" />
        <text className="is-muted" x={20} y={292}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'jacket') {
    return (
      <svg className="ll-drawing" viewBox="0 0 560 300" role="img" aria-label="P&ID of the reactor temperature loop, split-range on steam and cooling water">
        <path className="ll-steel" strokeWidth={2.5} d="M200 70V215Q200 250 300 250Q400 250 400 215V70Z" />
        <path className="ll-steel" strokeWidth={1.5} d="M215 85V210Q215 236 300 236Q385 236 385 210V85" />
        <text className="is-muted" x={300} y={160} textAnchor="middle">R-501</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 110H200" />
        <ControlValve x={90} y={110} open={50} tag="" label={false} />
        <text x={110} y={92}>TV-501B steam</text>
        <path className="ll-pipe" strokeWidth={3} d="M20 200H200" />
        <ControlValve x={90} y={200} open={50} tag="" label={false} />
        <text x={110} y={232}>TV-501A cooling water</text>
        <line className="ll-signal" x1={390} y1={140} x2={450} y2={140} />
        <Bubble x={470} y={140} letters="TT" num="501" />
        <line className="ll-signal" x1={470} y1={120} x2={470} y2={70} />
        <Bubble x={470} y={50} letters="TIC" num="501" shared />
        <path className="ll-signal" d="M450 50H40" />
        <Bubble x={40} y={50} letters="TY" num="501" shared />
        <text className="is-muted" x={64} y={30}>split at {config.kind === 'characterized' ? 'the balance point' : 'the split point'}</text>
        <path className="ll-signal" d="M40 70V150H90V158M40 150V170H60V240H90V208" />
        <text className="is-muted" x={20} y={292}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'blend') {
    const ratio = config.kind === 'ratio', cascade = config.kind === 'cascade' || ratio;
    const trim = !ratio || config.trim;
    return (
      <svg className="ll-drawing" viewBox="0 0 600 300" role="img" aria-label={`P&ID of the blending loop${ratio ? ' with ratio control' : ''}`}>
        <path className="ll-pipe" strokeWidth={3} d="M20 140H300" />
        <text className="is-muted" x={20} y={130}>diluent (wild)</text>
        <circle className="ll-block" cx={80} cy={140} r={11} />
        <path className="ll-pipe" strokeWidth={3} d="M20 240H260V150H300" />
        <text className="is-muted" x={20} y={262}>concentrate</text>
        <ControlValve x={110} y={240} open={50} tag="" label={false} />
        <text x={124} y={268}>FV-802</text>
        <circle className="ll-block" cx={200} cy={240} r={11} />
        <rect className="ll-block" x={300} y={125} width={70} height={40} rx={6} />
        <text className="is-muted" x={335} y={150} textAnchor="middle">mixer</text>
        <path className="ll-pipe" strokeWidth={3} d="M370 145H590" />
        <path className="ll-line" strokeDasharray="2 3" d="M470 145V185" />
        <Bubble x={470} y={205} letters="AT" num="803" />
        <path className="ll-signal" d="M490 205H560V40H520" />
        {trim && <Bubble x={500} y={40} letters="AIC" num="803" shared />}
        {cascade && (
          <>
            <line className="ll-signal" x1={200} y1={229} x2={200} y2={210} />
            <Bubble x={200} y={190} letters="FT" num="802" />
            <line className="ll-signal" x1={200} y1={170} x2={200} y2={110} />
            <Bubble x={200} y={90} letters="FIC" num="802" shared />
            <path className="ll-signal" d="M180 90H110V198" />
          </>
        )}
        {ratio ? (
          <>
            <line className="ll-signal" x1={80} y1={129} x2={80} y2={60} />
            <Bubble x={80} y={40} letters="FT" num="801" />
            <path className="ll-signal" d="M100 40H180" />
            <Bubble x={200} y={40} letters="FFY" num="802" shared />
            <text className="is-muted" x={224} y={30}>× ratio</text>
            {trim && <path className="ll-signal" d="M480 40H220" />}
            <line className="ll-signal" x1={200} y1={60} x2={200} y2={70} />
          </>
        ) : cascade ? <path className="ll-signal" d="M480 40H200V70" /> : <path className="ll-signal" d="M480 40H110V198" />}
        <text className="is-muted" x={20} y={292}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'feeder') {
    const smith = config.kind === 'smith';
    return (
      <svg className="ll-drawing" viewBox="0 0 560 270" role="img" aria-label={`P&ID of the feed rate loop${smith ? ' with a Smith predictor' : ''}`}>
        <path className="ll-steel" strokeWidth={2.5} d="M30 40H130L100 100H60Z" />
        <rect className="ll-block" x={50} y={100} width={120} height={22} rx={3} />
        <text className="is-muted" x={110} y={115} textAnchor="middle">screw</text>
        <path className="ll-steel" strokeWidth={2} d="M160 170H520" />
        <path className="ll-line" d="M165 122V165" />
        <text className="is-muted" x={340} y={190} textAnchor="middle">belt conveyor</text>
        <rect className="ll-block" x={20} y={150} width={50} height={30} rx={3} />
        <text x={45} y={170} textAnchor="middle">SC</text>
        <text className="is-muted" x={20} y={200}>VFD {proc.tags.valve}</text>
        <path className="ll-line" d="M45 150V122H50" />
        <path className="ll-line" d="M430 170V184M420 184H440" />
        <line className="ll-signal" x1={430} y1={170} x2={430} y2={130} />
        <Bubble x={430} y={110} letters="WT" num="701" />
        {smith ? (
          <>
            <line className="ll-signal" x1={410} y1={110} x2={360} y2={110} />
            <Bubble x={340} y={110} letters="WY" num="701" shared />
            <text className="is-muted" x={300} y={146}>Smith predictor</text>
            <line className="ll-signal" x1={340} y1={90} x2={340} y2={60} />
            <Bubble x={340} y={40} letters="WIC" num="701" shared />
            <path className="ll-signal" d="M360 46H380V80H360" strokeDasharray="2 3" />
          </>
        ) : (
          <>
            <line className="ll-signal" x1={430} y1={90} x2={430} y2={60} />
            <Bubble x={430} y={40} letters="WIC" num="701" shared />
          </>
        )}
        <path className="ll-signal" d={`M${smith ? 320 : 410} 40H10V165H20`} />
        <text className="is-muted" x={20} y={262}>{LEGEND}</text>
      </svg>
    );
  }
  if (proc.id === 'drum') {
    const cascade = config.kind === 'cascade';
    const ff = config.kind === 'feedforward' || config.kind === 'cascade' ? config.ff : [];
    const elements = 1 + (cascade ? 1 : 0) + (ff.length ? 1 : 0);
    return (
      <svg className="ll-drawing" viewBox="0 0 600 330" role="img" aria-label={`P&ID of the drum level loop: ${elements}-element control`}>
        <rect className="ll-steel" fill="none" strokeWidth={2.5} x={230} y={170} width={220} height={70} rx={35} />
        <text className="is-muted" x={340} y={210} textAnchor="middle">D-501 steam drum</text>
        {/* Steam out with flow transmitter */}
        <path className="ll-pipe" strokeWidth={3} d="M400 170V130H590" />
        <circle className="ll-block" cx={500} cy={130} r={11} />
        {/* Feedwater in */}
        <path className="ll-pipe" strokeWidth={3} d="M20 280H270V240" />
        <ControlValve x={90} y={280} open={50} tag="" label={false} />
        <text x={112} y={258}>FV-502</text>
        <circle className="ll-block" cx={190} cy={280} r={11} />
        {/* Level */}
        <line className="ll-signal" x1={450} y1={205} x2={500} y2={205} />
        <Bubble x={520} y={205} letters="LT" num="501" />
        <path className="ll-signal" d="M540 205H570V40H360" />
        <Bubble x={340} y={40} letters="LIC" num="501" shared />
        {cascade ? (
          <>
            <line className="ll-signal" x1={190} y1={269} x2={190} y2={160} />
            <Bubble x={190} y={140} letters="FT" num="502" />
            <line className="ll-signal" x1={190} y1={120} x2={190} y2={110} />
            <Bubble x={190} y={90} letters="FIC" num="502" shared />
            <path className="ll-signal" d={`M320 40H${ff.length ? 270 : 190}V${ff.length ? 52 : 70}`} />
            <path className="ll-signal" d="M170 90H90V238" />
          </>
        ) : <path className="ll-signal" d="M320 40H90V238" />}
        {ff.length > 0 && (
          <>
            <line className="ll-signal" x1={500} y1={119} x2={500} y2={100} />
            <Bubble x={500} y={80} letters="FT" num="503" />
            <path className="ll-signal" d="M480 80H290" />
            <Bubble x={270} y={80} letters="FY" num="503" shared />
            <text className="is-muted" x={250} y={128}>Σ: {cascade ? 'feedwater setpoint' : 'valve'}</text>
            {cascade && <path className="ll-signal" d="M250 80H210" />}
            {!cascade && <path className="ll-signal" d="M250 80H110V238" />}
          </>
        )}
        <text className="is-muted" x={20} y={20}>{elements === 3 ? 'Three-element: level, steam flow, feedwater flow' : elements === 2 ? 'Two-element' : 'Single-element: level only'}</text>
        <text className="is-muted" x={20} y={326}>{LEGEND}</text>
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
