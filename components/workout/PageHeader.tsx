import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  /** Short line under the title. */
  subtitle?: ReactNode;
  /** Buttons or status shown to the right of the title. */
  actions?: ReactNode;
  /** Where "back" goes (the workout home by default). */
  backHref?: string;
  backLabel?: string;
};

/** The same header on every workout sub-page: a back chip, the title, and optional actions. */
export default function PageHeader({ title, subtitle, actions, backHref = '/workout', backLabel = 'Workout' }: PageHeaderProps) {
  return (
    <header className="workout-page-header">
      <a href={backHref} className="workout-back">
        <span aria-hidden>‹</span> {backLabel}
      </a>
      <div className="workout-page-title">
        <h1>{title}</h1>
        {actions && <div className="workout-page-actions">{actions}</div>}
      </div>
      {subtitle && <p className="workout-hint workout-page-subtitle">{subtitle}</p>}
    </header>
  );
}
