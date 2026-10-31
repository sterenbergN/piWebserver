// Site-wide search over published content. Pure scoring so it's testable; the
// API route gathers the documents from disk.

export type SearchDoc = {
  kind: 'post' | 'album' | 'photo' | 'document' | 'project' | 'page';
  title: string;
  url: string;
  /** Short line shown under the title. */
  subtitle?: string;
  /** Extra searchable text that isn't shown (e.g. a post's markdown). */
  body?: string;
};

export type SearchHit = SearchDoc & { score: number; snippet?: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** A short excerpt of `text` around the first match of any term. */
function snippet(text: string, terms: string[]) {
  const lower = norm(text);
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return undefined;
  const start = Math.max(0, at - 40);
  const clean = text.slice(start, at + 100).replace(/[#*_`>\[\]()!]/g, '').replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${clean}…`;
}

/**
 * Rank documents for a query: every term must appear somewhere; matches in
 * the title count most, then the subtitle, then the body.
 */
export function searchDocs(docs: SearchDoc[], query: string, limit = 20): SearchHit[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 0).slice(0, 8);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const title = norm(doc.title);
    const subtitle = norm(doc.subtitle || '');
    const body = norm(doc.body || '');
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inSub = subtitle.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inSub && !inBody) { all = false; break; }
      score += (inTitle ? 10 : 0) + (inSub ? 4 : 0) + (inBody ? 1 : 0);
      if (title.startsWith(term)) score += 3;
    }
    if (!all) continue;
    if (doc.kind === 'post' || doc.kind === 'project') score += 1;
    const inTitleOnly = terms.every((t) => title.includes(t));
    hits.push({ ...doc, score, snippet: !inTitleOnly && doc.body ? snippet(doc.body, terms) : undefined });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Static pages worth finding by name. */
export const SITE_PAGES: SearchDoc[] = [
  { kind: 'page', title: 'About / Home', url: '/', subtitle: 'Experience, skills and projects', body: 'resume about me cv' },
  { kind: 'page', title: 'Resume', url: '/resume', subtitle: 'Printable resume', body: 'cv pdf print experience' },
  { kind: 'page', title: 'Posts', url: '/blog', subtitle: 'Blog and build logs', body: 'blog articles writing' },
  { kind: 'page', title: 'Gallery', url: '/gallery', subtitle: 'Photo albums', body: 'photos pictures images' },
  { kind: 'page', title: 'Library', url: '/library', subtitle: 'Documents and PDFs', body: 'pdf documents files' },
  { kind: 'page', title: 'Snake', url: '/game?game=snake', subtitle: 'Play snake, beat the leaderboard', body: 'game play arcade' },
  { kind: 'page', title: '2048', url: '/game?game=2048', subtitle: 'Slide and merge tiles', body: 'game play arcade puzzle' },
  { kind: 'page', title: 'Breakout', url: '/game?game=breakout', subtitle: 'Bounce the ball, clear the wall', body: 'game play arcade bricks paddle' },
  { kind: 'page', title: 'Blocks', url: '/game?game=blocks', subtitle: 'Falling blocks: fill lines to clear them', body: 'game play arcade puzzle tetris' },
  { kind: 'page', title: 'Flap', url: '/game?game=flap', subtitle: 'Tap to flap through the pipes', body: 'game play arcade bird' },
  { kind: 'page', title: 'Setpoint', url: '/game?game=setpoint', subtitle: 'Be the controller: hold the process in the band', body: 'game play arcade controls pid' },
  { kind: 'page', title: 'Chain Reaction', url: '/game?game=chain', subtitle: 'One tap, the biggest chain you can', body: 'game play arcade explosion' },
  { kind: 'page', title: 'Merge Snake', url: '/game?game=merge', subtitle: 'Snake meets 2048: eat in order and merge', body: 'game play arcade snake 2048 numbers' },
  { kind: 'page', title: 'Party games', url: '/party', subtitle: 'Quip Clash, The Faker, Trivia Death, Bracket Battles, Ready Set Bet', body: 'jackbox party host join' },
  { kind: 'page', title: 'Workout tracker', url: '/workout', subtitle: 'Gym log, analytics and reports', body: 'gym lift fitness training' },
  { kind: 'page', title: 'Loop Lab', url: '/loop-lab', subtitle: 'Control strategy lab: PID, gain scheduling and more', body: 'pid control loop tuning controller bode simulink plc siemens scl process control' },
  { kind: 'page', title: 'Case study: flow loop', url: '/loop-lab/cases/flow-pi', subtitle: 'Loop Lab: when PI is the answer', body: 'pid flow loop tuning lambda valve' },
  { kind: 'page', title: 'Case study: conical tank', url: '/loop-lab/cases/tank-schedule', subtitle: 'Loop Lab: gain scheduling and characterization', body: 'level tank gain scheduling nonlinear pid' },
  { kind: 'page', title: 'Case study: stirred tank', url: '/loop-lab/cases/stirred-pid', subtitle: 'Loop Lab: when derivative earns its keep', body: 'temperature pid derivative filter reactor jacket' },
  { kind: 'page', title: 'Case study: heat exchanger', url: '/loop-lab/cases/hx-cascade-ff', subtitle: 'Loop Lab: cascade and feedforward', body: 'cascade feedforward steam heat exchanger temperature' },
  { kind: 'page', title: 'Case study: surge tank', url: '/loop-lab/cases/surge-averaging', subtitle: 'Loop Lab: averaging level control', body: 'surge buffer tank averaging level control lambda integrating outflow' },
  { kind: 'page', title: 'Case study: belt feeder', url: '/loop-lab/cases/feeder-smith', subtitle: 'Loop Lab: dead time and the Smith predictor', body: 'dead time smith predictor belt feeder weigh scale transport delay' },
  { kind: 'page', title: 'Case study: boiler drum level', url: '/loop-lab/cases/drum-three-element', subtitle: 'Loop Lab: shrink, swell and three-element control', body: 'boiler drum level three element shrink swell feedwater steam cascade feedforward' },
  { kind: 'page', title: 'Case study: steam limit override', url: '/loop-lab/cases/hx-steam-limit', subtitle: 'Loop Lab: override control and windup', body: 'override selector constraint control windup external reset tracking steam limit' },
  { kind: 'page', title: 'Case study: split-range reactor', url: '/loop-lab/cases/jacket-split', subtitle: 'Loop Lab: heating and cooling from one controller', body: 'split range heating cooling reactor jacket temperature split point gap' },
  { kind: 'page', title: 'Case study: blending ratio', url: '/loop-lab/cases/blend-ratio', subtitle: 'Loop Lab: ratio control with an analyzer trim', body: 'ratio control blending wild flow analyzer trim concentration dosing' },
  { kind: 'page', title: 'Case study: crane anti-sway', url: '/loop-lab/cases/crane-antisway', subtitle: 'Loop Lab: state feedback and observers', body: 'crane trolley sway pendulum anti-sway state feedback observer kalman pole placement wind disturbance' },
  { kind: 'page', title: 'Case study: flexible shaft', url: '/loop-lab/cases/servo-resonance', subtitle: 'Loop Lab: damping a resonance', body: 'servo drive resonance two mass flexible shaft active damping notch cascade state feedback lqr' },
  { kind: 'page', title: 'Case study: magnetic levitation', url: '/loop-lab/cases/maglev-unstable', subtitle: 'Loop Lab: an unstable plant', body: 'maglev magnetic bearing levitation unstable pole placement pd setpoint weighting state feedback' },
  { kind: 'page', title: 'Case study: mixing tank', url: '/loop-lab/cases/mixing-mimo', subtitle: 'Loop Lab: interaction, decoupling and MPC', body: 'multivariable mimo interaction relative gain array rga pairing decoupler decoupling mpc model predictive control constraints mixing blending level temperature' },
  { kind: 'page', title: 'Case study: batch reactor', url: '/loop-lab/cases/batch-adaptive', subtitle: 'Loop Lab: adaptive control, ADRC and the cooling margin', body: 'batch reactor exothermic runaway semenov cooling margin adaptive self-tuning rls adrc disturbance observer' },
  { kind: 'page', title: 'Write your own controller', url: '/loop-lab/cases/write-your-own', subtitle: 'Loop Lab: Structured Text on the bench', body: 'structured text st iec 61131 scl custom controller code plc pi anti-windup bumpless' },
  { kind: 'page', title: 'Recipes', url: '/recipes', subtitle: 'Step-by-step cook mode, scaling, timers and grocery lists', body: 'cooking food meal prep kitchen ingredients' },
  { kind: 'page', title: 'Grocery list', url: '/recipes?view=list', subtitle: 'Recipes: what to buy, by aisle', body: 'shopping groceries store buy list' },
  { kind: 'page', title: 'Meal plan', url: '/recipes?view=week', subtitle: 'Recipes: plan the week and meal prep', body: 'dinner week planner prep' },
  { kind: 'page', title: 'Today', url: '/today', subtitle: 'Your day: question, habits, chores, workout', body: 'daily dashboard' },
  { kind: 'page', title: 'Daily questions', url: '/daily', subtitle: 'Engineering question of the day', body: 'quiz practice streak' },
  { kind: 'page', title: 'Habits', url: '/habits', subtitle: 'Habit tracker and garden', body: 'streak routine' },
  { kind: 'page', title: 'Chores', url: '/chores', subtitle: 'Household chores', body: 'cleaning household tasks' },
  { kind: 'page', title: 'Journal', url: '/journal', subtitle: 'Private daily entries and posts', body: 'diary mood writing' },
  { kind: 'page', title: 'Unit converter', url: '/tools#calculators', subtitle: 'Tools', body: 'calculator convert length weight temperature' },
  { kind: 'page', title: 'Movie picker', url: '/tools#movies', subtitle: 'Tools', body: 'film watch random' },
  { kind: 'page', title: 'Restaurant finder', url: '/tools#food', subtitle: 'Tools', body: 'food eat dinner' },
  { kind: 'page', title: 'Golf score tracker', url: '/tools#golf', subtitle: 'Tools', body: 'golf scorecard' },
  { kind: 'page', title: 'System stats', url: '/stats', subtitle: 'Raspberry Pi temperature, memory and storage', body: 'server pi cpu' },
];
