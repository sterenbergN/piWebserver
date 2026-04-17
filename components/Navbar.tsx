'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTheme } from './ThemeProvider';

export default function Navbar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: '/', label: 'About' },
    { href: '/gallery', label: 'Gallery' },
    { href: '/blog', label: 'Posts' },
    { href: '/library', label: 'Library' },
    { href: '/game', label: 'Play' },
    { href: '/workout', label: 'Workout' },
    { href: '/stats', label: 'Stats' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : [])
  ];

  const getStyle = (href: string) => {
    const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
    return {
      fontWeight: isActive ? '600' : 'normal',
      color: isActive ? 'var(--accent-light)' : 'inherit',
      borderBottom: isActive ? '2px solid var(--accent-light)' : '2px solid transparent',
      paddingBottom: '0.25rem',
      transition: 'all 0.2s ease',
      textDecoration: 'none',
      whiteSpace: 'nowrap' as const
    };
  };

  return (
    <nav className="glass-nav">
      <Link href="/" style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--foreground)', flexShrink: 0 }}>
        🐾 Noah Stuf
      </Link>

      {/* Desktop Links */}
      <div className="nav-links">
        {links.map(l => (
          <Link key={l.href} href={l.href} style={getStyle(l.href)}>{l.label}</Link>
        ))}
        <button
          onClick={toggleTheme}
          className="btn btn-secondary"
          style={{ padding: '0.4rem 0.75rem', fontSize: '1rem', lineHeight: 1 }}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {/* Mobile Right: Theme Toggle + Hamburger */}
      <div className="nav-mobile-controls">
        <button
          onClick={toggleTheme}
          className="btn btn-secondary"
          style={{ padding: '0.4rem 0.75rem', fontSize: '1rem', lineHeight: 1 }}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle navigation menu"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile Dropdown */}
      {menuOpen && (
        <div className="mobile-menu">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              style={{ ...getStyle(l.href), display: 'block', padding: '0.75rem 0', borderBottom: 'none', borderLeft: pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href)) ? '3px solid var(--accent-light)' : '3px solid transparent', paddingLeft: '1rem' }}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
