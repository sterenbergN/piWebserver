import type { DeadlineKind } from '@/lib/study/plan';

// One set of line icons for all of Study, so nothing depends on how a phone happens
// to draw its emoji. Sized in em, so an icon matches the text beside it.

const PATHS = {
  stethoscope: <><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 12 0v-4" /><circle cx="20" cy="10" r="2" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  tests: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
  review: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  map: <><path d="M14.1 4.6a2 2 0 0 0 1.8 0l3.6-1.8A1 1 0 0 1 21 3.7v12.7a1 1 0 0 1-.55.9l-4.55 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.6 1.8A1 1 0 0 1 3 20.3V7.6a1 1 0 0 1 .55-.9L8.1 4.4a2 2 0 0 1 1.8 0z" /><path d="M15 5.8v15M9 3.2v15" /></>,
  cap: <><path d="M22 10 12 5 2 10l10 5 10-5z" /><path d="M6 12.5V17c0 1.1 2.7 3 6 3s6-1.9 6-3v-4.5" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>,
  plus: <path d="M5 12h14M12 5v14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  right: <path d="M5 12h14M12 5l7 7-7 7" />,
  left: <path d="M19 12H5M12 19l-7-7 7-7" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  paste: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  skull: <><path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6.5V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.5c1.5-1.5 3-3.5 3-6.5a8 8 0 0 0-8-8z" /><circle cx="9" cy="11" r="1.4" /><circle cx="15" cy="11" r="1.4" /><path d="M10 21v-3M14 21v-3" /></>,
  snake: <path d="M3 19c3 0 3-3 6-3s3 3 6 3 6-2 6-5-2.5-5-5.5-5H9a3 3 0 0 1 0-6h10" />,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  file: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><path d="M14 2v6h6" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  compass: <><circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></>,
  trend: <path d="M22 7 13.5 15.5l-5-5L2 17M16 7h6v6" />,
  bed: <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10" /></>,
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  pancake: <><ellipse cx="12" cy="7.5" rx="9" ry="3.5" /><path d="M3 7.5v3c0 1.93 4 3.5 9 3.5s9-1.57 9-3.5v-3" /><path d="M3 13.5v3C3 18.43 7 20 12 20s9-1.57 9-3.5v-3" /></>,
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = '1.1em', className }: { name: IconName; size?: string; className?: string }) {
  return (
    <svg className={`sd-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

export const KIND_GLYPH: Record<DeadlineKind, IconName> = { exam: 'tests', quiz: 'pencil', practical: 'stethoscope', assignment: 'file', other: 'calendar' };

const NAV_GLYPH: Record<string, IconName> = {
  '/study': 'stethoscope', '/study/plan': 'calendar', '/study/tests': 'tests', '/study/review': 'review', '/study/games': 'moon',
  '/study/practice': 'users', '/study/map': 'map', '/study/classes': 'cap', '/study/anki': 'layers', '/study/add': 'plus',
};
/** Study's own pages get line icons in the nav. Everything else keeps its emoji. */
export const studyGlyph = (href: string): IconName | undefined => NAV_GLYPH[href];

/** "3" and a small pancake, read aloud as "3 pancakes". */
export function Pancakes({ count }: { count: number }) {
  return <span className="sd-pancakes" aria-label={`${count} pancake${count === 1 ? '' : 's'}`}><span aria-hidden>{count}</span><Icon name="pancake" size="1em" /></span>;
}
