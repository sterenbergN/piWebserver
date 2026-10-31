// Every place on the site, in one list. The launcher, the pinned links, the
// phone dock and the section bars are all drawn from it, so adding a page here
// puts it everywhere.

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** A shorter label for the phone dock. */
  short?: string;
  /** One line in the launcher. */
  blurb?: string;
  /** Other words people would search for. */
  keywords?: string;
};

export type NavGroup = {
  label: string;
  icon: string;
  items: NavItem[];
  /** Show the group's pages as a bar under the header ('wide': not on phones, where the page has its own tabs). */
  bar?: boolean | 'wide';
};

export function navGroups(isAdmin: boolean): NavGroup[] {
  return [
    {
      // Things that remember you: signing in keeps their progress.
      label: 'Daily',
      icon: '☀️',
      bar: true,
      items: [
        { href: '/today', label: 'Today', icon: '☀️', blurb: 'Everything for today, in one place', keywords: 'dashboard home day' },
        { href: '/daily', label: 'Questions', icon: '🧠', blurb: 'The engineering question of the day', keywords: 'quiz practice streak' },
        { href: '/habits', label: 'Habits', icon: '✅', blurb: 'Streaks and your garden', keywords: 'routine tracker' },
        { href: '/chores', label: 'Chores', icon: '🧹', blurb: 'What’s due at home', keywords: 'cleaning household tasks' },
        { href: '/journal', label: 'Journal', icon: '📓', blurb: 'Private entries and posts', keywords: 'diary mood writing' },
        { href: '/daily/leaderboard', label: 'Leaderboard', icon: '🏆', short: 'Ranks', blurb: 'How everyone’s doing', keywords: 'scores xp' },
      ],
    },
    {
      // The workout tracker and everything around it — the most used part of the site.
      label: 'Fitness',
      icon: '🏋️',
      bar: 'wide',
      items: [
        { href: '/workout', label: 'Workout', icon: '🏋️', blurb: 'Plan, log and track your lifts', keywords: 'gym lift training' },
        { href: '/workout/health', label: 'Health & plan', icon: '❤️', short: 'Health', blurb: 'Weight, sleep and your plan', keywords: 'body weight sleep nutrition' },
        { href: '/workout/analytics', label: 'Progress & coach', icon: '📈', short: 'Progress', blurb: 'Charts and what to do next', keywords: 'analytics charts coach' },
        { href: '/workout/calculators', label: 'Lifting calculators', icon: '🧮', short: 'Calc', blurb: 'One-rep max, plates and more', keywords: 'one rep max 1rm plates' },
      ],
    },
    {
      label: 'Kitchen',
      icon: '🍳',
      items: [
        { href: '/recipes', label: 'Recipes', icon: '🍳', blurb: 'Your recipe box and cook mode', keywords: 'cooking food' },
        { href: '/recipes?view=week', label: 'Meal plan', icon: '🗓️', short: 'Plan', blurb: 'Plan the week and meal prep', keywords: 'dinner week planner prep household share' },
        { href: '/recipes?view=list', label: 'Grocery list', icon: '🛒', short: 'Groceries', blurb: 'What to buy, by aisle', keywords: 'shopping groceries store buy household share' },
      ],
    },
    {
      label: 'Media',
      icon: '🖼️',
      bar: true,
      items: [
        { href: '/blog', label: 'Posts', icon: '📝', blurb: 'Write-ups and build logs', keywords: 'blog articles' },
        { href: '/gallery', label: 'Gallery', icon: '🖼️', blurb: 'Photo albums', keywords: 'photos pictures' },
        { href: '/library', label: 'Library', icon: '📚', blurb: 'Books, manuals and PDFs', keywords: 'documents pdf' },
      ],
    },
    {
      label: 'Play',
      icon: '🕹️',
      items: [
        { href: '/game', label: 'Arcade', icon: '🕹️', blurb: 'Eight games with leaderboards', keywords: 'games snake 2048 breakout' },
        { href: '/party', label: 'Party games', icon: '🎉', short: 'Party', blurb: 'For a group, on your phones', keywords: 'jackbox kart host join' },
      ],
    },
    {
      label: 'Tools',
      icon: '🧰',
      items: [
        { href: '/loop-lab', label: 'Loop Lab', icon: '🎛️', blurb: 'Control strategy lab', keywords: 'pid tuning control plc' },
        { href: '/tools#calculators', label: 'Calculators', icon: '🧮', blurb: 'Units and engineering sums', keywords: 'convert units' },
        { href: '/tools#movies', label: 'Movie picker', icon: '🎬', short: 'Movies', blurb: 'What to watch tonight', keywords: 'film random' },
        { href: '/tools#food', label: 'Where to eat', icon: '🍽️', short: 'Eat', blurb: 'Pick a restaurant', keywords: 'restaurant dinner' },
        { href: '/tools#golf', label: 'Golf scores', icon: '⛳', short: 'Golf', blurb: 'Keep a scorecard', keywords: 'scorecard' },
        { href: '/stats', label: 'Pi stats', icon: '📊', short: 'Stats', blurb: 'How the server is doing', keywords: 'server raspberry cpu memory' },
      ],
    },
    {
      label: 'About',
      icon: '👋',
      items: [
        { href: '/', label: 'Home', icon: '👋', blurb: 'Experience, skills and projects', keywords: 'about noah' },
        { href: '/resume', label: 'Resume', icon: '📄', blurb: 'The printable version', keywords: 'cv experience' },
        ...(isAdmin ? [{ href: '/admin', label: 'Admin', icon: '🔧', blurb: 'Backups, updates and content', keywords: 'settings backup' }] : []),
      ],
    },
  ];
}

/** Pinned until you choose your own: daily tools once signed in, the public site before that. */
export const defaultPins = (signedIn: boolean) =>
  signedIn
    ? ['/today', '/workout', '/recipes', '/recipes?view=list', '/journal']
    : ['/blog', '/gallery', '/recipes', '/game', '/tools#calculators'];

/** The site section a path belongs to; editors under /admin count as the page they edit. */
export function sectionOf(pathname: string) {
  if (pathname.startsWith('/admin/posts')) return '/blog';
  if (pathname.startsWith('/admin/resume')) return '/';
  return pathname;
}

/**
 * Whether a nav item is the page being shown. Items that share a page and differ
 * by #hash (the tools) or ?query (the kitchen) match on that too; none means the
 * page's first item.
 */
export function isCurrentItem(item: NavItem, section: string, hash: string, siblings: NavItem[], search = '') {
  const [withQuery, itemHash] = item.href.split('#');
  const [path, itemQuery] = withQuery.split('?');
  const within = (p: string) => section === p || (p !== '/' && section.startsWith(`${p}/`));
  if (!within(path)) return false;
  // /workout/health is "Health & plan", not also "Workout": the most specific item wins.
  const pathOf = (s: NavItem) => s.href.split(/[?#]/)[0];
  if (siblings.some((s) => { const sp = pathOf(s); return sp.length > path.length && sp.startsWith(`${path}/`) && within(sp); })) return false;
  const sharing = siblings.filter((s) => pathOf(s) === path);
  if (sharing.length < 2) return true;
  if (itemHash) return hash ? hash === itemHash : sharing[0] === item;
  const query = new URLSearchParams(search);
  // A recipe open from the plan or the list still counts as that view.
  if (itemQuery) return [...new URLSearchParams(itemQuery)].every(([k, v]) => query.get(k) === v);
  return !sharing.some((s) => s !== item && s.href.includes('?') && [...new URLSearchParams(s.href.split('?')[1])].every(([k, v]) => query.get(k) === v));
}

/** Pages whose name or words match every term of `query`, best first. */
export function matchNavItems(items: NavItem[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = items.flatMap((item) => {
    const label = item.label.toLowerCase();
    const rest = `${item.blurb ?? ''} ${item.keywords ?? ''}`.toLowerCase();
    if (!terms.every((t) => label.includes(t) || rest.includes(t))) return [];
    const score = terms.reduce((n, t) => n + (label.startsWith(t) ? 4 : label.includes(t) ? 2 : 1), 0);
    return [{ item, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
