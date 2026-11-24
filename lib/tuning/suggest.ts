import type { RefillLogEntry } from '@/lib/chess/puzzles';
import type { SiteTuning } from './site';

// Site-wide suggestions from how things went: where people's own tuned values settled
// (new people could start there), and how the puzzle top-up has been coping. Shown in
// Admin › Tuning to accept or dismiss; nothing site-wide changes on its own.

export type PersonTuning = {
  name: string;
  /** Their tuned level rule, if it has moved at least once. */
  mathStreakUp?: number;
  /** Their tuned puzzle aim, if it has moved at least once. */
  chessAimOffset?: number;
};

export type Suggestion = {
  id: 'math-streak' | 'chess-aim' | 'refill-count' | 'refill-cooldown';
  title: string;
  why: string;
  current: number;
  suggested: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const DAY = 86_400_000;

export function suggestTuning(site: SiteTuning, people: PersonTuning[], refills: RefillLogEntry[], now = new Date()): Suggestion[] {
  const out: Suggestion[] = [];

  const streaks = people.flatMap((p) => (p.mathStreakUp !== undefined ? [p.mathStreakUp] : []));
  if (streaks.length) {
    const to = Math.round(median(streaks));
    if (to !== site.mathStreakUp) {
      out.push({ id: 'math-streak', title: 'Quick math: right answers in a row to level up, for new people', current: site.mathStreakUp, suggested: to,
        why: `${streaks.filter((s) => s === to).length} of ${streaks.length} ${streaks.length === 1 ? 'person whose level rule has tuned itself' : 'people whose level rules have tuned themselves'} settled at ${to}. Starting new people there means less dropping straight back.` });
    }
  }

  const aims = people.flatMap((p) => (p.chessAimOffset !== undefined ? [p.chessAimOffset] : []));
  if (aims.length) {
    const to = Math.round(median(aims) / 25) * 25;
    if (to !== site.chessAimOffset) {
      out.push({ id: 'chess-aim', title: 'Chess: how far below someone’s Elo puzzles start out', current: site.chessAimOffset, suggested: to,
        why: `${aims.length === 1 ? 'The one player tuned so far is' : `The ${aims.length} players tuned so far are`} at ${aims.join(', ')} below. Starting there gets new players to about two in three solved sooner.` });
    }
  }

  const recent = refills.filter((r) => r.trigger === 'auto' && now.getTime() - Date.parse(r.at) < 14 * DAY);
  const worked = recent.filter((r) => !r.error);
  if (worked.length >= 4) {
    const to = Math.min(500, Math.round((site.refill.count * 1.5) / 10) * 10);
    if (to !== site.refill.count) {
      out.push({ id: 'refill-count', title: 'Puzzle top-up: how many to fetch each time', current: site.refill.count, suggested: to,
        why: `The automatic top-up ran ${worked.length} times in the last two weeks, so players are getting through puzzles faster than it adds them. Fetching more at once means fewer downloads from Lichess.` });
    }
  }
  const failed = recent.filter((r) => r.error);
  if (failed.length >= 3 && site.refill.cooldownMinutes < 60) {
    out.push({ id: 'refill-cooldown', title: 'Puzzle top-up: minutes to wait between tries', current: site.refill.cooldownMinutes, suggested: 60,
      why: `${failed.length} automatic top-ups failed in the last two weeks (last: ${failed[failed.length - 1].error}). Trying less often stops it hammering Lichess while something's wrong.` });
  }

  return out.filter((s) => site.dismissed[s.id] !== String(s.suggested));
}

/** Put a suggestion into the site's values. */
export function applySuggestion(site: SiteTuning, s: Suggestion, now = new Date()) {
  if (s.id === 'math-streak') site.mathStreakUp = s.suggested;
  if (s.id === 'chess-aim') site.chessAimOffset = s.suggested;
  if (s.id === 'refill-count') site.refill.count = s.suggested;
  if (s.id === 'refill-cooldown') site.refill.cooldownMinutes = s.suggested;
  site.log = [...site.log, { at: now.toISOString(), what: s.title, from: String(s.current), to: String(s.suggested) }].slice(-30);
  delete site.dismissed[s.id];
}
