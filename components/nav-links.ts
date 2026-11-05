// Every place on the site, in one list, arranged by what you came to do. The
// rooms in the Explore panel and on the home page, the pinned links, the phone
// dock and the section bars are all drawn from it, so adding a page here puts it
// everywhere.

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** A shorter label for the phone dock. */
  short?: string;
  /** One line under its name. */
  blurb?: string;
  /** Other words people would search for. */
  keywords?: string;
  /** Only useful signed in: still shown, with a lock, to everyone else. */
  account?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: string;
  /** What you'd be asking yourself when this is the room you want. */
  question: string;
  /** The room's colour: a theme variable, so it reads in light and dark. */
  color: string;
  items: NavItem[];
  /** The smaller places inside the room's pages, so nothing is only found by wandering in. */
  corners?: { label: string; items: NavItem[] }[];
  /** Something you can do without leaving the panel. */
  action?: 'party-join' | 'grocery-add';
  /** Takes up more of the map: there's more in this room. */
  wide?: boolean;
  /** Show the group's pages as a bar under the header ('wide': not on phones, where the page has its own tabs). */
  bar?: boolean | 'wide';
};

// Each game's own page. Kept as plain data, not read from the games' code, so the
// header doesn't load the games; a test checks these lists against the real ones.
const ARCADE_GAMES: NavItem[] = [
  { href: '/game?game=snake', label: 'Snake', icon: '🐍', blurb: 'Eat, grow, don’t bite yourself' },
  { href: '/game?game=2048', label: '2048', icon: '🔢', blurb: 'Slide and merge tiles' },
  { href: '/game?game=breakout', label: 'Breakout', icon: '🧱', blurb: 'Bounce the ball, clear the wall' },
  { href: '/game?game=blocks', label: 'Blocks', icon: '🟪', blurb: 'Fill lines to clear them' },
  { href: '/game?game=flap', label: 'Flap', icon: '🐤', blurb: 'Tap to flap through the gaps' },
  { href: '/game?game=setpoint', label: 'Setpoint', icon: '🎛️', blurb: 'You’re the controller: hold the process in the band' },
  { href: '/game?game=chain', label: 'Chain Reaction', icon: '💥', blurb: 'One tap, the biggest chain you can' },
  { href: '/game?game=merge', label: 'Merge Snake', icon: '🔗', blurb: 'Snake meets 2048' },
];

const PARTY_GAMES: NavItem[] = ([
  ['kart-clash', 'Kart Clash', '🏎️', 'Your phone is the steering wheel'],
  ['ready-set-bet', 'Ready Set Bet', '🐎', 'Bet live as horses race'],
  ['quip-clash', 'Quip Clash', '⚡', 'Silly prompts, vote for the funniest'],
  ['bracket-battles', 'Bracket Battles', '🏆', 'Your wildest answers fight it out'],
  ['emoji-telephone', 'Emoji Telephone', '🔗', 'Watch the chain derail'],
  ['the-faker', 'The Faker', '🕵️', 'Vote out whoever’s faking'],
  ['spyfall', 'Spyfall', '🕵️‍♀️', 'One spy doesn’t know the location'],
  ['bluff-clash', 'Bluff Clash', '🤥', 'Write fakes and fool your friends'],
  ['trivia-death', 'Trivia Death', '💀', 'Answer right or become a ghost'],
  ['wavelength', 'Wavelength', '📡', 'One clue, dial in the bullseye'],
  ['herd-mentality', 'Herd Mentality', '🐄', 'Think like the crowd'],
] as const).map(([id, label, icon, blurb]) => ({ href: `/party?tab=host&guide=${id}`, label, icon, blurb, keywords: 'party rules how to play' }));

export function navGroups(isAdmin: boolean): NavGroup[] {
  return [
    {
      // Things that remember you: signing in keeps their progress.
      id: 'day',
      label: 'My day',
      icon: '☀️',
      question: 'What’s on for today?',
      color: 'var(--habit-4)',
      bar: true,
      items: [
        { href: '/today', label: 'Today', icon: '☀️', blurb: 'Everything for today, in one place', keywords: 'dashboard home day' },
        { href: '/daily', label: 'Questions', icon: '🧠', blurb: 'The engineering question of the day', keywords: 'quiz practice streak' },
        { href: '/habits', label: 'Habits', icon: '✅', blurb: 'Keep your streaks going', keywords: 'routine tracker' },
        { href: '/chores', label: 'Chores', icon: '🧹', blurb: 'What’s due at home', keywords: 'cleaning household tasks' },
        { href: '/journal', label: 'Journal', icon: '📓', blurb: 'A private place to write', keywords: 'diary mood writing', account: true },
        { href: '/reader', label: 'Reader', icon: '📖', blurb: 'Your books and notes, with or without a connection', keywords: 'ebook epub pdf kindle reading annotate highlight offline', account: true },
        { href: '/notes', label: 'Notes', icon: '✏️', blurb: 'Notebooks you write in, with or without a connection', keywords: 'goodnotes notability handwriting pencil notebook pdf annotate lecture recording offline', account: true },
        { href: '/daily/leaderboard', label: 'Leaderboard', icon: '🏆', short: 'Ranks', blurb: 'How everyone’s doing', keywords: 'scores xp' },
      ],
      corners: [{
        label: 'Tucked inside',
        items: [
          { href: '/habits#garden', label: 'Habit garden', icon: '🌱', blurb: 'Your habits, growing', keywords: 'plants' },
          { href: '/habits#stats', label: 'Habit stats', icon: '📊', blurb: 'Streaks and charts' },
          { href: '/daily#practice', label: 'Practice', icon: '🎲', blurb: 'Questions any time, by topic', keywords: 'quiz' },
          { href: '/daily#archive', label: 'Past questions', icon: '🗂️', blurb: 'Every day so far', keywords: 'archive' },
          { href: '/daily#stats', label: 'Question stats', icon: '📈', blurb: 'How you’re doing by topic' },
          { href: '/chores#garden', label: 'Chore garden', icon: '🪴', blurb: 'Every chore grows a plant', keywords: 'plants' },
          { href: '/chores#home', label: 'Household', icon: '🏠', blurb: 'Share chores, meals and groceries', keywords: 'invite family share' },
          { href: '/journal/posts', label: 'Private posts', icon: '🔏', blurb: 'Longer pieces, just for you', keywords: 'writing', account: true },
        ],
      }],
    },
    {
      // A space of its own: practice tests and the questions you keep missing, each
      // account seeing only its own. On phones these pages are the dock, so no bar.
      id: 'study',
      label: 'Study',
      icon: '🩺',
      question: 'Got an exam coming?',
      color: 'var(--habit-6)',
      bar: 'wide',
      items: [
        { href: '/study', label: 'PA Today', icon: '🩺', short: 'Today', blurb: 'What’s waiting today, and when you can stop', keywords: 'study school pa pance home', account: true },
        { href: '/study/plan', label: 'Plan', icon: '🥞', blurb: 'What’s coming up, and the pancakes before it', keywords: 'planner calendar exams due dates countdown schedule syllabus', account: true },
        { href: '/study/tests', label: 'Practice tests', icon: '📝', short: 'Tests', blurb: 'Take the tests your AI writes from your notes', keywords: 'study exam quiz school pa pance', account: true },
        { href: '/study/review', label: 'Review misses', icon: '🔁', short: 'Review', blurb: 'What you missed comes back until you know it', keywords: 'miss bank spaced repetition', account: true },
        { href: '/study/games', label: 'Games', icon: '🌙', blurb: 'The Night Shift, Differential, Study Snake and Trivia Death', keywords: 'play fun trivia party solo night shift differential puzzle snake', account: true },
        { href: '/study/practice', label: 'Practice', icon: '🧑‍⚕️', blurb: 'Comparison grids, Quiz me and mock patients', keywords: 'osce history taking grids compare partner quiz', account: true },
        { href: '/study/map', label: 'PANCE map', icon: '🗺️', short: 'Map', blurb: 'Every organ system: covered, studied and proven', keywords: 'blueprint coverage boards organ systems exam', account: true },
        { href: '/study/classes', label: 'Classes', icon: '🎓', blurb: 'What you’ve finished, and what it covers', keywords: 'modules courses checklist catch up', account: true },
        { href: '/study/anki', label: 'Anki', icon: '🗂️', blurb: 'Make cards with your AI, import decks, send misses', keywords: 'flashcards cards export import deck apkg prompt make cloze', account: true },
        { href: '/study/add', label: 'Add a test', icon: '➕', short: 'Add', blurb: 'Copy a prompt, paste back what your AI writes', keywords: 'import paste notes ai prompt', account: true },
        { href: '/study/shared', label: 'Shared tests', icon: '🤝', short: 'Shared', blurb: 'Tests your friends have shared, and the ones you share', keywords: 'share publish public friends classmates link copy pool', account: true },
      ],
    },
    {
      // Games come in two sizes, and a room full of people shouldn't have to hunt for theirs.
      id: 'play',
      label: 'Game night',
      icon: '🎉',
      question: 'Got friends over, or five minutes to kill?',
      color: 'var(--habit-7)',
      action: 'party-join',
      wide: true,
      items: [
        { href: '/party', label: 'Party games', icon: '🎉', short: 'Party', blurb: 'Join friends with a room code', keywords: 'jackbox kart join group friends' },
        { href: '/party?tab=host', label: 'Host a party', icon: '📺', short: 'Host', blurb: 'On the TV, or phones only', keywords: 'jackbox start tv group friends' },
        { href: '/game', label: 'Arcade', icon: '🕹️', blurb: 'Solo games with leaderboards', keywords: 'games high score' },
      ],
      corners: [
        { label: 'At the party', items: PARTY_GAMES },
        { label: 'In the arcade', items: ARCADE_GAMES },
      ],
    },
    {
      // The workout tracker and everything around it — the most used part of the site.
      id: 'gym',
      label: 'Gym',
      icon: '🏋️',
      question: 'Time to lift?',
      color: 'var(--habit-8)',
      bar: 'wide',
      items: [
        { href: '/workout', label: 'Workout', icon: '🏋️', blurb: 'Plan, log and track your lifts', keywords: 'gym lift training', account: true },
        { href: '/workout/health', label: 'Health & plan', icon: '❤️', short: 'Health', blurb: 'Weight, sleep and your plan', keywords: 'body weight sleep nutrition', account: true },
        { href: '/workout/analytics', label: 'Progress & coach', icon: '📈', short: 'Progress', blurb: 'Charts and what to do next', keywords: 'analytics charts coach', account: true },
        { href: '/workout/calculators', label: 'Lifting calculators', icon: '🧮', short: 'Calc', blurb: 'One-rep max, plates and more', keywords: 'one rep max 1rm plates' },
      ],
      corners: [{
        label: 'Tucked inside',
        items: [
          { href: '/workout/analytics?tab=coach', label: 'Coach', icon: '🧑‍🏫', blurb: 'What to do next', account: true },
          { href: '/workout/health?tab=plan', label: 'My plan', icon: '🎯', blurb: 'Calories and goals', account: true },
          { href: '/workout/config', label: 'Gyms & equipment', icon: '🏟️', blurb: 'What your gyms have', keywords: 'machines plates', account: true },
          { href: '/workout/report', label: 'Report', icon: '🖨️', blurb: 'A printable summary', account: true },
        ],
      }],
    },
    {
      id: 'kitchen',
      label: 'Kitchen',
      icon: '🍳',
      question: 'What’s for dinner?',
      color: 'var(--habit-2)',
      action: 'grocery-add',
      items: [
        { href: '/recipes', label: 'Recipes', icon: '🍳', blurb: 'The recipe box and cook mode', keywords: 'cooking food' },
        { href: '/recipes?view=week', label: 'Meal plan', icon: '🗓️', short: 'Plan', blurb: 'Plan the week and meal prep', keywords: 'dinner week planner prep household share' },
        { href: '/recipes?view=list', label: 'Grocery list', icon: '🛒', short: 'Groceries', blurb: 'What to buy, by aisle', keywords: 'shopping groceries store buy household share' },
        { href: '/recipes?view=pantry', label: 'Pantry', icon: '🥫', blurb: 'What you have at home, and what to use up', keywords: 'kitchen stock ran out have ingredients shelf leftovers' },
      ],
    },
    {
      id: 'workshop',
      label: 'Workshop',
      icon: '🛠️',
      question: 'Feel like tinkering?',
      color: 'var(--habit-3)',
      items: [
        { href: '/loop-lab', label: 'Loop Lab', icon: '🎛️', blurb: 'Try control strategies on live processes', keywords: 'pid tuning control plc' },
        { href: '/tools#calculators', label: 'Calculators', icon: '🧮', blurb: 'Units and engineering sums', keywords: 'convert units' },
        { href: '/stats', label: 'Pi stats', icon: '📊', short: 'Stats', blurb: 'The Raspberry Pi running all this, live', keywords: 'server raspberry cpu memory' },
        ...(isAdmin ? [{ href: '/admin', label: 'Admin', icon: '🔧', blurb: 'Backups, updates and content', keywords: 'settings backup' }] : []),
      ],
      ...(isAdmin ? { corners: [{ label: 'Admin only', items: [
        { href: '/admin#accounts', label: 'Accounts', icon: '👥', blurb: 'Who can sign in', keywords: 'users add people login' },
      ] }] } : {}),
    },
    {
      // Time off, in or out: a round of golf, a film, somewhere to eat. The id is still
      // 'night' from when this was "Night off"; ROOM_ORDER below goes by it.
      id: 'night',
      label: 'Free time',
      icon: '🌤️',
      question: 'Got a free afternoon?',
      color: 'var(--habit-5)',
      items: [
        { href: '/golf', label: 'Golf & disc golf', icon: '⛳', short: 'Golf', blurb: 'Score rounds, measure shots, see your numbers', keywords: 'golf disc golf scorecard handicap gps distance basket frisbee lost disc' },
        { href: '/tools#movies', label: 'Movie picker', icon: '🎬', short: 'Movies', blurb: 'What to watch tonight', keywords: 'film random' },
        { href: '/tools#food', label: 'Where to eat', icon: '🍽️', short: 'Eat', blurb: 'Pick a restaurant for you', keywords: 'restaurant dinner' },
      ],
    },
    {
      id: 'noah',
      label: 'Meet Noah',
      icon: '👋',
      question: 'Who made all this?',
      color: 'var(--habit-1)',
      bar: true,
      items: [
        { href: '/', label: 'Home', icon: '👋', blurb: 'Experience, skills and projects', keywords: 'about noah' },
        { href: '/resume', label: 'Resume', icon: '📄', blurb: 'The printable version', keywords: 'cv experience' },
        { href: '/blog', label: 'Posts', icon: '📝', blurb: 'Write-ups and build logs', keywords: 'blog articles' },
        { href: '/gallery', label: 'Gallery', icon: '🖼️', blurb: 'Photo albums', keywords: 'photos pictures' },
        { href: '/library', label: 'Library', icon: '📚', blurb: 'Books, manuals and PDFs', keywords: 'documents pdf' },
      ],
    },
  ];
}

/** Your own day first once signed in; a visitor starts with who this is and what's fun. */
const ROOM_ORDER = { signedIn: ['day', 'play', 'gym', 'kitchen', 'night', 'workshop', 'study', 'noah'], visitor: ['noah', 'play', 'kitchen', 'night', 'workshop', 'day', 'study', 'gym'] };

export function orderRooms(groups: NavGroup[], signedIn: boolean, studyFirst = false) {
  const order = signedIn ? ROOM_ORDER.signedIn : ROOM_ORDER.visitor;
  const rank = (id: string) => (studyFirst && id === 'study' ? -1 : order.indexOf(id));
  return [...groups].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Whether a path is inside Study, which has its own navigation. */
export const isStudyPath = (path: string) => path === '/study' || path.startsWith('/study/');

/** Every page and corner, once each. */
export function allPlaces(groups: NavGroup[]) {
  return groups.flatMap((g) => [...g.items, ...(g.corners ?? []).flatMap((c) => c.items)]);
}

/** The places you could actually go right now. */
export const placesFor = (groups: NavGroup[], signedIn: boolean) => allPlaces(groups).filter((p) => signedIn || !p.account);

/** Somewhere you haven't been yet (anywhere at all once you've been everywhere), never where you are. */
export function pickSurprise(places: NavItem[], found: Iterable<string>, current?: string, random = Math.random) {
  const seen = new Set(found);
  const elsewhere = places.filter((p) => p.href !== current);
  const fresh = elsewhere.filter((p) => !seen.has(p.href));
  const from = fresh.length ? fresh : elsewhere;
  return from[Math.floor(random() * from.length)];
}

/** Whether the URL is exactly this place: for corners, which are more specific than their page. */
export function atPlace(item: NavItem, path: string, hash: string, search = '') {
  const [withQuery, itemHash = ''] = item.href.split('#');
  const [itemPath, itemQuery = ''] = withQuery.split('?');
  if (itemPath !== path || (itemHash && itemHash !== hash)) return false;
  const query = new URLSearchParams(search);
  return [...new URLSearchParams(itemQuery)].every(([k, v]) => query.get(k) === v);
}

/** Pinned until you choose your own: daily tools once signed in, the public site before that. */
export const defaultPins = (signedIn: boolean, studyHome = false) =>
  signedIn && studyHome ? ['/study', '/study/plan', '/study/tests', '/study/review', '/study/map', '/today'] :
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
