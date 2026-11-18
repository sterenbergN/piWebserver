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
  const veryDense = plates.length >= 10;
  const dense = plates.length >= 6;
  const shaftW = veryDense ? 16 : dense ? 28 : 48;
  const collarW = dense ? 6 : 8;
  const sleeveW = veryDense ? 12 : dense ? 18 : 28;
  const gap = veryDense ? 1 : dense ? 1.5 : 2;
  const heavyW = veryDense ? 10 : dense ? 14 : 18;
  const lightW = veryDense ? 7 : dense ? 9 : 12;
  const fontSize = veryDense ? '0.45rem' : dense ? '0.52rem' : '0.6rem';

  return (
    <figure style={{ margin: '1.25rem 0 0', textAlign: 'center' }} aria-label={`Load per side: ${plates.join(', ')} lbs`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: veryDense ? 'flex-start' : 'center', height: 90, maxWidth: '100%', overflowX: 'auto' }}>
        {/* bar shaft + collar */}
        <div style={{ flexShrink: 0, width: shaftW, height: 8, background: 'var(--muted)', opacity: 0.6, borderRadius: '4px 0 0 4px' }} />
        <div style={{ flexShrink: 0, width: collarW, height: 22, background: 'var(--muted)', borderRadius: 2 }} />
        {plates.map((plate, index) => {
          const color = PLATE_COLORS[String(plate)] || 'var(--accent)';
          const light = color === '#f5f5f5' || color === '#eab308';
          return (
            <div
              key={index}
              title={`${plate} lb`}
              style={{
                flexShrink: 0,
                width: plate >= 25 ? heavyW : lightW,
                height: plateHeight(plate),
                marginLeft: gap,
                background: color,
                borderRadius: 3,
                border: '1px solid rgba(0,0,0,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                writingMode: 'vertical-rl',
                fontSize,
                fontWeight: 700,
                color: light ? '#111' : '#fff',
              }}
            >
              {plate}
            </div>
          );
        })}
        {/* sleeve end */}
        <div style={{ flexShrink: 0, width: sleeveW, height: 12, marginLeft: gap, background: 'var(--muted)', opacity: 0.45, borderRadius: '0 4px 4px 0' }} />
      </div>
      <figcaption className="workout-hint" style={{ marginTop: '0.35rem' }}>
        Per side: {plates.join(' + ')} · bar {barWeight} → {totalWeight} lbs
      </figcaption>
    </figure>
  );
}
