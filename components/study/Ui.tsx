import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// The small pieces every Study page shares.

/** Placeholder shapes while a page loads, so it doesn't jump when the content arrives. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="sd-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

export const scoreTone = (percent: number) => (percent >= 80 ? 'is-good' : percent >= 60 ? 'is-ok' : 'is-low');

/** A percentage as a ring that fills in. */
export function ScoreRing({ percent, size = 112, label, tone }: { percent: number; size?: number; label?: string; tone?: string }) {
  const stroke = Math.max(5, size * 0.075);
  const radius = (size - stroke) / 2;
  const around = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, percent));
  return (
    <span className={`sd-ring ${tone ?? scoreTone(value)}`} style={{ width: size, height: size }} role="img" aria-label={`${label ? `${label}: ` : ''}${value}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="sd-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle className="sd-ring-fill" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={around} strokeDashoffset={around * (1 - value / 100)} style={{ '--sd-around': around } as React.CSSProperties} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="sd-ring-text" aria-hidden style={{ fontSize: size * 0.27 }}>{value}<small>%</small></span>
    </span>
  );
}

/** Icon, heading and a thing to do, for a page or card with nothing on it yet. */
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <section className="sd-card sd-empty">
      <span className="sd-empty-icon"><Icon name={icon} size="1.5rem" /></span>
      <h2>{title}</h2>
      <div className="hb-hint">{children}</div>
      {action && <Link className="btn btn-primary" href={action.href}>{action.label}</Link>}
    </section>
  );
}

/** The heading row for a card: a tinted icon, a title and what it's for. */
export function CardHead({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="sd-card-title">
      <span className="sd-tile-icon"><Icon name={icon} size="1.2rem" /></span>
      <div>
        <h2>{title}</h2>
        {children && <p className="hb-hint">{children}</p>}
      </div>
    </div>
  );
}
