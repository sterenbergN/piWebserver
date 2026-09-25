'use client';

import { getIntensityLabel, INTENSITY_MAX, INTENSITY_MIN, INTENSITY_STEP } from '@/lib/workout/intensity';

type IntensitySliderProps = {
  value: number;
  onChange: (value: number) => void;
  title?: string;
  /** Larger value readout, used where the slider is the page's main control. */
  prominent?: boolean;
};

const TRACK_GRADIENT = 'linear-gradient(to right, var(--info) 0%, var(--success) 40%, var(--warning) 70%, var(--danger) 100%)';

/** Intensity factor slider (0.5 Recovery – 1.5 Max Push) shared by the tracker, profile and analytics. */
export default function IntensitySlider({ value, onChange, title = 'Workout Intensity', prominent = false }: IntensitySliderProps) {
  const info = getIntensityLabel(value);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.35rem', columnGap: '0.5rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
        <span style={{ fontSize: prominent ? '1.1rem' : '0.85rem', fontWeight: 700, color: info.color, whiteSpace: 'nowrap' }}>
          {info.emoji} {info.label} ({value.toFixed(2)})
        </span>
      </div>
      <input
        type="range"
        min={INTENSITY_MIN}
        max={INTENSITY_MAX}
        step={INTENSITY_STEP}
        value={value}
        aria-label={title}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: '6px',
          WebkitAppearance: 'none',
          appearance: 'none',
          borderRadius: '3px',
          outline: 'none',
          cursor: 'pointer',
          background: TRACK_GRADIENT,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
        <span>🧘 Recovery</span>
        <span>⚖️ Standard</span>
        <span>🔥 Push</span>
      </div>
    </div>
  );
}
