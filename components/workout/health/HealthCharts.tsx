'use client';

import './health.css';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinutes, type SeriesPoint } from '@/lib/workout/health-insights';

// Charts for the health page and workout history. Same marks as the
// analytics charts: thin rounded bars, 2px lines, hairline grid, a tooltip on
// every chart, one series per chart (no second y-axis).

const tooltipStyle = {
  background: 'var(--background)',
  border: '1px solid var(--surface-border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--foreground)',
};
const tick = { fill: 'var(--muted)', fontSize: 10 };
const shortNumber = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(Math.round(n)));
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/** Steps per day (or per day averaged over each week). */
export function StepsBars({ data, average, height = 150 }: { data: SeriesPoint[]; average: number | null; height?: number }) {
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label="Steps per day">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -6 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} interval="preserveStartEnd" minTickGap={22} />
          <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={shortNumber} allowDecimals={false} width={40} />
          {average !== null && <ReferenceLine y={average} stroke="var(--muted)" strokeDasharray="4 3" />}
          <Tooltip
            cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(label, items) => ((items?.[0]?.payload as SeriesPoint)?.days > 1 ? `Week of ${label}` : String(label))}
            formatter={(value, _name, item) => [`${Number(value).toLocaleString()} steps${(item?.payload as SeriesPoint)?.days > 1 ? ' a day' : ''}`, '']}
            separator=""
          />
          <Bar dataKey="steps" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SleepTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeriesPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p || p.sleepHours === undefined) return null;
  const stage = (name: string, min?: number) => (min ? <div className="hc-tip-row"><span>{name}</span><strong>{formatMinutes(min)}</strong></div> : null);
  return (
    <div style={tooltipStyle} className="hc-tip">
      <div className="hc-tip-title">{p.days > 1 ? `Week of ${p.label}` : p.label}</div>
      <div className="hc-tip-row"><span>Asleep{p.days > 1 ? ' (avg)' : ''}</span><strong>{formatMinutes(p.sleepHours * 60)}</strong></div>
      {stage('Deep', p.deepMin)}
      {stage('Core', p.coreMin)}
      {stage('REM', p.remMin)}
      {stage('Awake', p.awakeMin)}
      {p.bedtime && <div className="hc-tip-sub">{clock(p.bedtime)} → {clock(p.wake)}</div>}
    </div>
  );
}

/** Hours asleep per night, with your usual amount as a reference line. */
export function SleepBars({ data, usualHours, height = 160 }: { data: SeriesPoint[]; usualHours: number | null; height?: number }) {
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label="Hours asleep per night">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -10 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} interval="preserveStartEnd" minTickGap={22} />
          <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={(h) => `${h}h`} domain={[0, (max: number) => Math.max(9, Math.ceil(max))]} allowDecimals={false} width={40} />
          {usualHours !== null && <ReferenceLine y={usualHours} stroke="var(--muted)" strokeDasharray="4 3" />}
          <Tooltip cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }} content={<SleepTooltip />} />
          <Bar dataKey="sleepHours" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One measurement over time (resting HR, HRV, weight, body fat). Gaps are bridged. */
export function TrendLine({ data, dataKey, unit, digits = 0, height = 120 }: { data: SeriesPoint[]; dataKey: keyof SeriesPoint; unit: string; digits?: number; height?: number }) {
  const values = data.map((d) => d[dataKey]).filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return <p className="workout-hint hc-empty">Not enough readings yet for a trend.</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(digits ? 0.5 : 2, (max - min) * 0.2);
  const dots = data.length <= 31;
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label={`${String(dataKey)} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} interval="preserveStartEnd" minTickGap={22} />
          <YAxis tickLine={false} axisLine={false} tick={tick} domain={[Math.floor(min - pad), Math.ceil(max + pad)]} allowDecimals={digits > 0} width={40} />
          <Tooltip
            cursor={{ stroke: 'var(--surface-border)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(label, items) => ((items?.[0]?.payload as SeriesPoint)?.days > 1 ? `Week of ${label}` : String(label))}
            formatter={(value) => [`${Number(value).toFixed(digits)} ${unit}`, '']}
            separator=""
          />
          <Line type="monotone" dataKey={dataKey as string} connectNulls stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            dot={dots ? { r: 3, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 2 } : false}
            activeDot={{ r: 5, stroke: 'var(--background)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Heart rate through each day: the average as a line, inside a band from the lowest to the highest reading. */
export function HeartRangeChart({ data, height = 150 }: { data: SeriesPoint[]; height?: number }) {
  const points = data.filter((d) => typeof d.hrAvg === 'number');
  if (points.length < 2) return <p className="workout-hint hc-empty">Not enough days of heart rate yet for a trend.</p>;
  const lows = data.flatMap((d) => (d.hrRange ? [d.hrRange[0]] : []));
  const highs = data.flatMap((d) => (d.hrRange ? [d.hrRange[1]] : []));
  const dots = data.length <= 31;
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label="Heart rate through each day: average, lowest and highest">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} interval="preserveStartEnd" minTickGap={22} />
          <YAxis tickLine={false} axisLine={false} tick={tick} domain={[Math.floor((Math.min(...lows) - 5) / 10) * 10, Math.ceil((Math.max(...highs) + 5) / 10) * 10]} width={40} />
          <Tooltip
            cursor={{ stroke: 'var(--surface-border)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(label, items) => ((items?.[0]?.payload as SeriesPoint)?.days > 1 ? `Week of ${label}` : String(label))}
            formatter={(value, name) => (Array.isArray(value) ? [`${value[0]}–${value[1]} bpm`, 'Range'] : [`${value} bpm`, 'Average'])}
            separator=" "
          />
          <Area type="linear" dataKey="hrRange" connectNulls stroke="none" fill="var(--accent)" fillOpacity={0.16} isAnimationActive={false} activeDot={false} />
          <Line type="monotone" dataKey="hrAvg" connectNulls stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            dot={dots ? { r: 3, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 2 } : false}
            activeDot={{ r: 5, stroke: 'var(--background)', strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Under a heart rate chart whose sets were moved to match it: by how much. */
export function alignNote(offsetSec?: number) {
  if (!offsetSec) return '';
  const secs = Math.abs(offsetSec);
  const span = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs} s`;
  return offsetSec < 0
    ? `Sets moved ${span} earlier to match your heart rate: you tend to tap a set done about that long after finishing it.`
    : `Sets moved ${span} later to match your heart rate.`;
}

/** Heart rate through a workout, with a faint mark where each set was logged. */
export function HeartRateChart({ trace, sets = [], avg, height = 150 }: { trace: [number, number][]; sets?: { at: number; label: string }[]; avg?: number; height?: number }) {
  const data = trace.map(([t, bpm]) => ({ t, bpm }));
  const bpms = trace.map(([, b]) => b);
  const end = data.length ? data[data.length - 1].t : 0;
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label="Heart rate during the workout">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="t" type="number" domain={[0, end]} tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} tickFormatter={(s) => `${Math.round(s / 60)}m`} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} tick={tick} domain={[Math.floor((Math.min(...bpms) - 8) / 10) * 10, Math.ceil((Math.max(...bpms) + 8) / 10) * 10]} width={40} />
          {sets.filter((s) => s.at >= 0 && s.at <= end).map((s, i) => (
            <ReferenceLine key={`${s.at}-${i}`} x={s.at} stroke="var(--muted)" strokeOpacity={0.45} strokeDasharray="2 3" />
          ))}
          {avg !== undefined && <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 3" />}
          <Tooltip
            cursor={{ stroke: 'var(--surface-border)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(t) => {
              const near = sets.find((s) => Math.abs(s.at - Number(t)) <= 45);
              return `${mmss(Number(t))}${near ? ` · ${near.label}` : ''}`;
            }}
            formatter={(value) => [`${value} bpm`, '']}
            separator=""
          />
          <Line type="monotone" dataKey="bpm" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 5, stroke: 'var(--background)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Sets logged in a workout as chart marks: seconds from `start`, labelled
 * "Bench 185×5", moved by `offsetSec` to where the heart rate shows them.
 */
export function setMarks(workout: { logs?: Record<string, { weight?: number; reps?: number; timestamp?: number }[]>; liftMeta?: Record<string, { name?: string }> }, startIso: string, offsetSec = 0) {
  const start = Date.parse(startIso) - offsetSec * 1000;
  return Object.entries(workout.logs || {}).flatMap(([liftId, sets]) => (sets || [])
    .filter((s) => typeof s.timestamp === 'number')
    .map((s) => ({ at: Math.round((s.timestamp! - start) / 1000), label: `${workout.liftMeta?.[liftId]?.name || 'Set'} ${s.weight}×${s.reps}` })))
    .sort((a, b) => a.at - b.at);
}

/** The dashed reference line's meaning, under a chart. */
export function RefLegend({ children }: { children: React.ReactNode }) {
  return <span className="hc-legend"><span className="hc-legend-dash" aria-hidden />{children}</span>;
}
