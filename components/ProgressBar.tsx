type ProgressBarProps = {
  /** 0–100; leave out while the length of the job is unknown (the bar slides). */
  value?: number;
  label?: React.ReactNode;
  detail?: React.ReactNode;
};

/** Progress bar: determinate with a value, a sliding "busy" bar without. */
export default function ProgressBar({ value, label, detail }: ProgressBarProps) {
  const known = typeof value === 'number';
  return (
    <div role="progressbar" aria-busy={!known} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(value) : undefined} aria-label={typeof label === 'string' ? label : undefined}>
      {(label || detail) && (
        <div className="progress-label">
          <span>{label}</span>
          {detail !== undefined && <span>{detail}</span>}
        </div>
      )}
      <div className={`progress${known ? '' : ' is-indeterminate'}`}>
        <div style={known ? { width: `${Math.max(2, Math.min(100, value))}%` } : undefined} />
      </div>
    </div>
  );
}
