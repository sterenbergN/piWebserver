'use client';

// Competition-style plate colors so the diagram matches what's on the rack.
const PLATE_COLORS: Record<string, string> = {
  '55': '#dc2626',
  '45': '#2563eb',
  '35': '#eab308',
  '25': '#16a34a',
  '15': '#eab308',
  '10': '#f5f5f5',
  '5': '#dc2626',
  '2.5': '#4b5563',
  '1.25': '#9ca3af',
};

function plateHeight(weight: number) {
  // Heavier plates are taller, like real bumper/iron plates.
  return Math.round(28 + Math.min(1, weight / 45) * 52);
}

type PlateDiagramProps = {
  /** Plates for ONE side, heaviest first. */
  plates: number[];
  barWeight: number;
  totalWeight: number;
};

/** Side view of one sleeve of a loaded barbell. */
export default function PlateDiagram({ plates, barWeight, totalWeight }: PlateDiagramProps) {
  return (
    <figure style={{ margin: '1.5rem 0 0', textAlign: 'center' }} aria-label={`Load per side: ${plates.join(', ')} lbs`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 90 }}>
        {/* bar shaft + collar */}
        <div style={{ width: 48, height: 8, background: 'var(--muted)', opacity: 0.6, borderRadius: '4px 0 0 4px' }} />
        <div style={{ width: 8, height: 22, background: 'var(--muted)', borderRadius: 2 }} />
        {plates.map((plate, index) => {
          const color = PLATE_COLORS[String(plate)] || 'var(--accent)';
          const light = color === '#f5f5f5' || color === '#eab308';
          return (
            <div
              key={index}
              title={`${plate} lb`}
              style={{
                width: plate >= 25 ? 18 : 12,
                height: plateHeight(plate),
                marginLeft: 2,
                background: color,
                borderRadius: 3,
                border: '1px solid rgba(0,0,0,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                writingMode: 'vertical-rl',
                fontSize: '0.6rem',
                fontWeight: 700,
                color: light ? '#111' : '#fff',
              }}
            >
              {plate}
            </div>
          );
        })}
        {/* sleeve end */}
        <div style={{ width: 28, height: 12, marginLeft: 2, background: 'var(--muted)', opacity: 0.45, borderRadius: '0 4px 4px 0' }} />
      </div>
      <figcaption className="workout-hint" style={{ marginTop: '0.35rem' }}>
        Per side: {plates.join(' + ')} · bar {barWeight} → {totalWeight} lbs
      </figcaption>
    </figure>
  );
}
