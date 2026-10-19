import { CPU_PARTS, describeLoad, formatClock, type CpuDetail } from '@/lib/cpu-detail';

/**
 * What the CPU percentage is made of: a stacked bar by kind of work
 * (apps, kernel, interrupts, I/O wait), one bar per core, then load and clock.
 * Shared by the stats page and the admin overview.
 */
export default function CpuBreakdown({ detail, align = 'center' }: { detail: CpuDetail; align?: 'center' | 'start' }) {
  const load = describeLoad(detail.load, detail.cores.length);
  const clock = formatClock(detail.mhz, detail.maxMhz);
  const parts = CPU_PARTS.filter((p) => detail[p.key] >= 0.05);
  const manyCores = detail.cores.length > 8;

  return (
    <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.6rem', textAlign: align === 'center' ? 'center' : 'left', fontSize: '0.75rem' }}>
      <div aria-hidden style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--input-bg)', border: '1px solid var(--surface-border)' }}>
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${Math.min(100, detail[p.key])}%`, background: p.color, opacity: p.key === 'iowait' ? 0.5 : 1 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.7rem', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
        {CPU_PARTS.map((p) => (
          <span key={p.key} title={p.title} style={{ whiteSpace: 'nowrap', cursor: 'help' }}>
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, opacity: p.key === 'iowait' ? 0.5 : 1, marginRight: 4 }} />
            {p.label} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{detail[p.key].toFixed(1)}%</b>
          </span>
        ))}
      </div>

      {detail.cores.length > 0 && (
        <div role="list" aria-label="Busy per core" style={{ display: 'grid', gridTemplateColumns: `repeat(${detail.cores.length}, minmax(0, 1fr))`, gap: manyCores ? 2 : 6 }}>
          {detail.cores.map((pct, i) => (
            <div key={i} role="listitem" title={`Core ${i + 1}: ${pct.toFixed(1)}% busy`} aria-label={`Core ${i + 1}: ${Math.round(pct)}% busy`}>
              <div style={{ height: 32, display: 'flex', alignItems: 'flex-end', borderRadius: 4, background: 'var(--input-bg)', border: '1px solid var(--surface-border)', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: `${Math.min(100, pct)}%`, minHeight: pct > 0 ? 1 : 0, background: 'var(--accent-light)' }} />
              </div>
              {!manyCores && <div style={{ marginTop: 2, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</div>}
            </div>
          ))}
        </div>
      )}

      {(load || clock) && (
        <div style={{ opacity: 0.7, display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.7rem', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
          {load && <span title={load.title} style={{ cursor: 'help' }}>{load.text}</span>}
          {clock && <span title="Current CPU clock (it drops when idle or throttled for heat)">{clock}</span>}
        </div>
      )}
    </div>
  );
}
