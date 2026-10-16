'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Small single-series charts for the analytics page. Marks follow one spec:
// thin bars with rounded tops, 2px lines, 8px dots with a surface ring, solid
// hairline grid, compact axis ticks and a tooltip on every chart.

export function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

const tooltipStyle = {
  background: 'var(--background)',
  border: '1px solid var(--surface-border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--foreground)',
};

/** One value per week as columns (e.g. sets per week). */
export function WeeklyBars({ data, valueKey, unit, height = 170 }: { data: { label: string }[]; valueKey: string; unit: string; height?: number }) {
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label={`${unit} per week`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={compact} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }} contentStyle={tooltipStyle} labelFormatter={(label) => `Week of ${label}`} formatter={(value) => [`${Number(value).toLocaleString()} ${unit}`, '']} separator="" />
          <Bar dataKey={valueKey} fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Estimated 1RM per session, with an optional goal line. */
export function StrengthLine({ data, goal, height = 200 }: { data: { label: string; e1rm: number; detail: string }[]; goal?: number; height?: number }) {
  const values = data.map((d) => d.e1rm);
  const min = Math.min(...values, goal ?? Infinity);
  const max = Math.max(...values, goal ?? 0);
  const pad = Math.max(5, (max - min) * 0.15);
  return (
    <div className="an-chart" style={{ height }} role="img" aria-label="Estimated one-rep max by session">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} domain={[Math.floor((min - pad) / 5) * 5, Math.ceil((max + pad) / 5) * 5]} width={40} />
          {goal && (
            <ReferenceLine y={goal} stroke="var(--muted)" strokeWidth={1} label={{ value: `Goal ${Math.round(goal)}`, position: 'insideTopRight', fill: 'var(--muted)', fontSize: 10 }} />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--surface-border)' }}
            contentStyle={tooltipStyle}
            formatter={(value, _name, item) => [`${Math.round(Number(value))} lbs est. 1RM · ${(item?.payload as { detail?: string })?.detail || ''}`, '']}
            separator=""
          />
          <Line type="monotone" dataKey="e1rm" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            dot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 2 }} activeDot={{ r: 6, stroke: 'var(--background)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny trend line (no axes) for list rows; the last point is marked. */
export function Sparkline({ values, width = 72, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="an-spark-empty" aria-hidden>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="an-spark">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} fill="var(--accent)" stroke="var(--background)" strokeWidth={1.5} />
    </svg>
  );
}

/** Signed percent change, coloured by direction (up is good), or nothing. */
export function Delta({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  const tone = pct > 0 ? 'is-up' : pct < 0 ? 'is-down' : '';
  return <span className={`an-delta ${tone}`}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '='} {pct > 0 ? '+' : ''}{pct}%{suffix}</span>;
}
