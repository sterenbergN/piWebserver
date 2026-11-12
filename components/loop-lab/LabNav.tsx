'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const LAB_SECTIONS = [
  { href: '/loop-lab/bench', label: '🎛️ Bench' },
  { href: '/loop-lab/builder', label: '🧩 Block Studio' },
  { href: '/loop-lab/cases', label: '📖 Case Studies' },
  { href: '/loop-lab/processes', label: '🏭 Processes' },
  { href: '/loop-lab/controllers', label: '🪜 Controllers' },
];

/** Sleek, modern sticky engineering studio navigation bar for Loop Lab. */
export default function LabNav() {
  const path = usePathname();
  const isBuilder = path === '/loop-lab/builder' || path.startsWith('/loop-lab/builder/');
  const isBench = path === '/loop-lab/bench' || path.startsWith('/loop-lab/bench/');

  return (
    <nav className="ll-nav" aria-label="Loop Lab Studio Navigation">
      <div className="ll-nav-brand">
        <Link className="ll-nav-home" href="/loop-lab" aria-current={path === '/loop-lab' ? 'page' : undefined}>
          <span className="ll-nav-logo">⚡ Loop Lab</span>
          <span className="ll-nav-tag">Control Engineering Studio</span>
        </Link>
      </div>

      <div className="ll-nav-links">
        {LAB_SECTIONS.map((s) => {
          const isActive = path === s.href || path.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`ll-nav-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div className="ll-nav-actions">
        {!isBuilder && (
          <Link
            className="ll-nav-pill is-builder"
            href="/loop-lab/builder"
            title="Wire blocks into a loop and simulate it"
          >
            🧩 Block Studio
          </Link>
        )}
        {!isBench && (
          <Link
            className="ll-nav-pill is-bench"
            href="/loop-lab/bench"
            title="Open Interactive Test Bench"
          >
            🎛️ Open Bench
          </Link>
        )}
      </div>
    </nav>
  );
}

