'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/loop-lab/bench', label: 'Bench' },
  { href: '/loop-lab/cases', label: 'Case studies' },
  { href: '/loop-lab/processes', label: 'Processes' },
  { href: '/loop-lab/controllers', label: 'Controllers' },
];

/** Loop Lab's own sections, on every Loop Lab page. */
export default function LabNav() {
  const path = usePathname();
  return (
    <nav className="ll-nav" aria-label="Loop Lab">
      <Link className="ll-nav-home" href="/loop-lab" aria-current={path === '/loop-lab' ? 'page' : undefined}>Loop Lab</Link>
      <div className="ll-nav-links">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} aria-current={path === s.href || path.startsWith(`${s.href}/`) ? 'page' : undefined}>{s.label}</Link>
        ))}
      </div>
    </nav>
  );
}
