'use client';

import Link from 'next/link';

const QUICK_LINKS = [
  { href: '/admin', label: '⚙️ Admin' },
  { href: '/admin/resume', label: '📄 Home & Resume' },
  { href: '/admin/posts', label: '📝 Posts & Drafts' },
  { href: '/gallery', label: '🖼️ Gallery' },
  { href: '/cad', label: '🧊 3D / CAD' },
  { href: '/party/admin', label: '🎉 Party Admin' },
] as const;

export default function AdminQuickNav({ current }: { current: string }) {
  return (
    <nav className="adm-quick" aria-label="Admin quick switch">
      {QUICK_LINKS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="adm-quick-link"
          aria-current={current === item.href ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
