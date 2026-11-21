/**
 * Every quick action and keyboard shortcut on the site, in one place, so the key
 * in the search panel (components/ShortcutsKey.tsx) can't drift from the list.
 * It only documents what the code does: when a handler changes, change its entry.
 */

/** One key on a keyboard. A pair is for keys that differ by computer: [Mac, PC]. */
export type KeyToken = string | { mac: string; pc: string };
/** Keys pressed together, e.g. [Ctrl, K]. */
export type Combo = KeyToken[];

export type Section = 'anywhere' | 'search' | 'page';

export type Shortcut = {
  /** Stable name; the Navbar test and tooltips can refer to it. */
  id: string;
  section: Section;
  /** A heading inside the section (e.g. "Typed commands"). */
  group?: string;
  /** Ways to press it; any one works. */
  keys?: Combo[];
  /** Text to type, e.g. "/note"; works on a phone too. */
  typed?: string[];
  /** Shown instead when there is nothing to press or type ("Just type"). */
  label?: string;
  does: string;
  /** Only works signed in. */
  signedIn?: boolean;
  /** Page entries: the paths it works on (a path and anything under it). */
  where?: string[];
  /** Page entries: what the page is called in the key. */
  page?: string;
  /** Left alone while a text field has focus. */
  notInTextField?: boolean;
};

const CTRL: KeyToken = { mac: '⌘', pc: 'Ctrl' };
const ALT: KeyToken = { mac: 'Option', pc: 'Alt' };

export const SECTION_TITLES: Record<Section, string> = {
  anywhere: 'Anywhere',
  search: 'In the search box',
  page: 'On pages',
};

export const SHORTCUTS: Shortcut[] = [
  // Anywhere (components/Navbar.tsx)
  { id: 'open-search', section: 'anywhere', keys: [['/'], [CTRL, 'K']], does: 'Open search: jump to any page or look something up', notInTextField: true },
  { id: 'open-ask', section: 'anywhere', keys: [['?']], does: 'Open search ready to ask a question (saved to Skills → Lookups)', signedIn: true, notInTextField: true },
  { id: 'open-note', section: 'anywhere', keys: [[ALT, 'N']], does: 'Jot a quick note from any page', signedIn: true, notInTextField: true },
  { id: 'open-keys', section: 'anywhere', keys: [[CTRL, '/']], typed: ['/keys'], does: 'Show this key of shortcuts' },
  { id: 'toggle-calc', section: 'anywhere', group: 'Calculator', keys: [[ALT, 'C']], typed: ['/calc'], does: 'Open or close the floating calculator. Type /calc then Space anywhere on a page, or /calculator, to open it' },
  { id: 'calc-keys', section: 'anywhere', group: 'Calculator', keys: [['Enter'], ['=']], does: 'In the calculator, work out the answer' },
  { id: 'calc-recall', section: 'anywhere', group: 'Calculator', keys: [['↑']], does: 'In the calculator, bring the last sum back (after = or with an empty display)' },
  { id: 'calc-fraction', section: 'anywhere', group: 'Calculator', keys: [['/'], ['^']], does: 'In the calculator, / makes a fraction and ^ a power; arrow keys move between the boxes' },
  { id: 'calc-close', section: 'anywhere', group: 'Calculator', keys: [['Esc']], does: 'Close the calculator (when search isn’t open)' },

  // In the search box (components/Launcher.tsx)
  { id: 'find', section: 'search', group: 'Modes and commands', label: 'Just type', does: 'Find pages, then content, across the site. Enter opens the best match' },
  { id: 'mode-ask', section: 'search', group: 'Modes and commands', typed: ['?'], does: 'Type ? first to switch to Ask: save a question to look up later', signedIn: true },
  { id: 'mode-note', section: 'search', group: 'Modes and commands', typed: ['/note', '/n', '/jot'], does: 'Save a quick note: /note walk the dog. On its own it opens your notes', signedIn: true },
  { id: 'mode-list', section: 'search', group: 'Modes and commands', typed: ['add', 'buy'], does: 'add milk or buy milk offers to put it on the grocery list' },
  { id: 'mode-calc', section: 'search', group: 'Modes and commands', typed: ['/calc', '/calculator'], does: 'Open the calculator, optionally with a sum: /calc 2+2' },
  { id: 'mode-keys', section: 'search', group: 'Modes and commands', typed: ['/keys', '/shortcuts', '/help'], does: 'Show this key' },
  { id: 'mode-buttons', section: 'search', group: 'Modes and commands', label: 'Tap a mode', does: 'The Find, Ask, Grocery list and Quick note buttons under the box switch what Enter does' },
  { id: 'box-enter', section: 'search', group: 'In the box', keys: [['Enter']], does: 'Open the best match, or save in Ask, Grocery list and Quick note' },
  { id: 'box-down', section: 'search', group: 'In the box', keys: [['↓']], does: 'Move from the box into the results and icons' },
  { id: 'box-arrows', section: 'search', group: 'In the box', keys: [['←'], ['→'], ['↑'], ['↓']], does: 'Walk the icons in order (← →), or to the nearest one above or below (↑ ↓). ↑ from the top goes back to the box' },
  { id: 'box-tab', section: 'search', group: 'In the box', keys: [['Tab']], does: 'Move between buttons; focus stays inside the panel' },
  { id: 'box-backspace', section: 'search', group: 'In the box', keys: [['Backspace']], does: 'In an empty Ask, Grocery list or Quick note box, go back to Find' },
  { id: 'box-esc', section: 'search', group: 'In the box', keys: [['Esc']], does: 'Close search (or finish choosing shortcuts first)' },

  // Pages
  { id: 'reader-turn', section: 'page', page: 'Reader', where: ['/reader'], keys: [['←'], ['→'], ['PageUp'], ['PageDown'], ['Space']], does: 'Turn the page (Space goes forward)', notInTextField: true },
  { id: 'reader-tools', section: 'page', page: 'Reader', where: ['/reader'], keys: [['P'], ['E'], ['N']], does: 'Pen or highlighter (P), eraser (E), open your notes (N)', notInTextField: true },
  { id: 'reader-find', section: 'page', page: 'Reader', where: ['/reader'], keys: [[CTRL, 'F']], does: 'Search inside the open book' },
  { id: 'reader-back', section: 'page', page: 'Reader', where: ['/reader'], keys: [['Esc']], does: 'Close the open panel, then drawing mode, then the book', notInTextField: true },
  { id: 'audio-keys', section: 'page', page: 'Reader audio', where: ['/reader'], keys: [['Space'], ['←'], ['→'], ['Esc']], does: 'Play or pause, back 15 seconds, forward 30 seconds, leave the player', notInTextField: true },

  { id: 'notes-pages', section: 'page', page: 'Notes', where: ['/notes'], keys: [['←'], ['→'], ['PageUp'], ['PageDown']], does: 'Previous or next page', signedIn: true, notInTextField: true },
  { id: 'notes-scroll', section: 'page', page: 'Notes', where: ['/notes'], keys: [['↑'], ['↓'], ['Space']], does: 'Scroll the page', signedIn: true, notInTextField: true },
  { id: 'notes-tools', section: 'page', page: 'Notes', where: ['/notes'], keys: [['P'], ['H'], ['E'], ['L'], ['S'], ['T']], does: 'Pick a tool: pen, highlighter, eraser, lasso, shape, text', signedIn: true, notInTextField: true },
  { id: 'notes-undo', section: 'page', page: 'Notes', where: ['/notes'], keys: [[CTRL, 'Z'], [CTRL, 'Shift', 'Z']], does: 'Undo, and redo', signedIn: true, notInTextField: true },
  { id: 'notes-select', section: 'page', page: 'Notes', where: ['/notes'], keys: [[CTRL, 'C'], [CTRL, 'X'], [CTRL, 'D'], ['Delete']], does: 'With a selection: copy, cut, duplicate, delete', signedIn: true, notInTextField: true },

  { id: 'quicknote-edit', section: 'page', page: 'Quick notes', where: ['/quick-notes'], keys: [['Enter'], ['Esc']], does: 'While editing a note: save it, or drop the edit', signedIn: true },

  { id: 'gallery-lightbox', section: 'page', page: 'Gallery', where: ['/gallery'], keys: [['←'], ['→'], ['Esc']], does: 'In a photo: previous or next, close' },
  { id: 'gallery-frame', section: 'page', page: 'Gallery', where: ['/gallery'], keys: [['←'], ['→'], ['Space'], ['Esc']], does: 'In frame mode: step, pause or play, leave' },

  { id: 'cook-steps', section: 'page', page: 'Cook mode', where: ['/recipes'], keys: [['←'], ['→'], ['Esc']], does: 'Previous or next step, close cook mode', notInTextField: true },

  { id: 'journal-format', section: 'page', page: 'Journal', where: ['/journal'], keys: [[CTRL, 'B'], [CTRL, 'I']], does: 'Bold or italic while writing. Enter keeps a list going', signedIn: true },
  { id: 'private-post-format', section: 'page', page: 'Journal', where: ['/journal/posts'], keys: [[CTRL, 'K'], [CTRL, 'S']], does: 'In a private post: add a link, save', signedIn: true },
  { id: 'blog-format', section: 'page', page: 'Post editor', where: ['/admin/posts'], keys: [[CTRL, 'B'], [CTRL, 'I'], [CTRL, 'K'], [CTRL, 'S']], does: 'Bold, italic, link, save' },

  { id: 'study-test', section: 'page', page: 'Practice tests and review', where: ['/study/tests', '/study/review'], keys: [['A–H'], ['1–8'], ['Enter']], does: 'Pick that choice, then check or go on. In a test, ← → move between questions', signedIn: true, notInTextField: true },
  { id: 'cards-drill', section: 'page', page: 'Anki cards', where: ['/study/anki'], keys: [['Space'], ['Enter'], ['1'], ['2'], ['3'], ['4']], does: 'Flip the card, then grade it: again, hard, good, easy', signedIn: true, notInTextField: true },
  { id: 'skills-recall', section: 'page', page: 'Skills review', where: ['/skills'], keys: [['Space'], ['Enter'], ['1'], ['2'], ['3'], ['4']], does: 'Show the answer, then rate how well you knew it. Enter also moves on after a graded question', signedIn: true, notInTextField: true },

  { id: 'arcade-lobby', section: 'page', page: 'Arcade', where: ['/game'], keys: [['←'], ['↑'], ['↓'], ['→'], ['Enter']], does: 'In the lobby: pick a game, then play it', notInTextField: true },
  { id: 'arcade-move', section: 'page', page: 'Arcade', where: ['/game'], keys: [['←'], ['↑'], ['↓'], ['→'], ['W'], ['A'], ['S'], ['D']], does: 'Steer Snake and 2048, move the paddle in Breakout, move and rotate in Blocks (↑ or W turns)', notInTextField: true },
  { id: 'arcade-pause', section: 'page', page: 'Arcade', where: ['/game'], keys: [['P'], ['Space']], does: 'Pause (P in Breakout, Blocks and Flap; Space in Snake and Breakout). Space or ↑ also launches the ball in Breakout and flaps in Flap', notInTextField: true },
  { id: 'arcade-blocks', section: 'page', page: 'Arcade', where: ['/game'], keys: [['Z'], ['X'], ['C'], ['Space']], does: 'Blocks: turn left or right, hold a piece, hard drop', notInTextField: true },
  { id: 'arcade-undo', section: 'page', page: 'Arcade', where: ['/game'], keys: [['U']], does: '2048: undo a move', notInTextField: true },
  { id: 'arcade-again', section: 'page', page: 'Arcade', where: ['/game'], keys: [['Enter']], does: 'Play again after a game ends (not while a name box is waiting)', notInTextField: true },
];

/** Does this path fall under one of the entry's pages ("/reader" covers "/reader/abc", not "/readers")? */
export function onPath(entry: Shortcut, pathname: string): boolean {
  return !!entry.where?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The key's sections, in order, with page entries split into this page and the rest. */
export function shortcutsFor(pathname: string): { anywhere: Shortcut[]; search: Shortcut[]; here: Shortcut[]; other: Shortcut[] } {
  const pages = SHORTCUTS.filter((s) => s.section === 'page');
  return {
    anywhere: SHORTCUTS.filter((s) => s.section === 'anywhere'),
    search: SHORTCUTS.filter((s) => s.section === 'search'),
    here: pages.filter((s) => onPath(s, pathname)),
    other: pages.filter((s) => !onPath(s, pathname)),
  };
}

/** Group entries by their heading, keeping first-seen order. Entries with no heading come first, under ''. */
export function groupBy(entries: Shortcut[], by: (s: Shortcut) => string | undefined): [string, Shortcut[]][] {
  const out = new Map<string, Shortcut[]>();
  for (const e of entries) {
    const key = by(e) ?? '';
    out.set(key, [...(out.get(key) ?? []), e]);
  }
  return [...out.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0));
}

/** The text of a key for this computer. */
export function keyText(token: KeyToken, mac: boolean): string {
  return typeof token === 'string' ? token : mac ? token.mac : token.pc;
}

/** What the box means by these: "/keys", "/shortcuts" and "/help", on their own. */
export const KEYS_COMMAND = /^\/(?:keys|shortcuts|help)\s*$/i;
