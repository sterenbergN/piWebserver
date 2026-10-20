// What the navbar shows. A group with a single item is shown as a plain link,
// so a group can grow into a dropdown just by adding to its list.

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { label: string; items: NavItem[] };

export function navGroups(isAdmin: boolean): NavGroup[] {
  return [
    { label: 'About', items: [{ href: '/', label: 'About', icon: '👋' }] },
    {
      label: 'Media',
      items: [
        { href: '/gallery', label: 'Gallery', icon: '🖼️' },
        { href: '/blog', label: 'Posts', icon: '📝' },
        { href: '/library', label: 'Library', icon: '📚' },
      ],
    },
    {
      label: 'Play',
      items: [
        { href: '/game', label: 'Arcade', icon: '🕹️' },
        { href: '/party', label: 'Party', icon: '🎉' },
      ],
    },
    {
      // Things that remember you: signing in keeps their progress.
      label: 'Daily',
      items: [
        { href: '/daily', label: 'Questions', icon: '🧠' },
        { href: '/habits', label: 'Habits', icon: '✅' },
        { href: '/workout', label: 'Workout', icon: '🏋️' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { href: '/tools#calculators', label: 'Calculators', icon: '🧮' },
        { href: '/tools#movies', label: 'Movie picker', icon: '🎬' },
        { href: '/tools#food', label: 'Where to eat', icon: '🍽️' },
        { href: '/tools#golf', label: 'Golf scores', icon: '⛳' },
        { href: '/stats', label: 'Pi stats', icon: '📊' },
      ],
    },
    ...(isAdmin ? [{ label: 'Admin', items: [{ href: '/admin', label: 'Admin', icon: '🔧' }] }] : []),
  ];
}

/** The site section a path belongs to; editors under /admin count as the page they edit. */
export function sectionOf(pathname: string) {
  if (pathname.startsWith('/admin/posts')) return '/blog';
  if (pathname.startsWith('/admin/resume')) return '/';
  return pathname;
}

/**
 * Whether a nav item is the page being shown. Items that share a page and differ
 * by #hash (the tools) match on the hash too; no hash means the page's first one.
 */
export function isCurrentItem(item: NavItem, section: string, hash: string, siblings: NavItem[]) {
  const [path, itemHash] = item.href.split('#');
  const onPage = section === path || (path !== '/' && section.startsWith(`${path}/`));
  if (!onPage || !itemHash) return onPage;
  if (hash) return hash === itemHash;
  return siblings.find((s) => s.href.split('#')[0] === path) === item;
}
