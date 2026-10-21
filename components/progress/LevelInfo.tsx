'use client';

import { LEVEL_TITLES, levelFromXp, nextTitle, xpForLevel } from '@/lib/progress/levels';
import { XP_RULES } from '@/lib/daily/progress';
import { XP as HABIT_XP } from '@/lib/habits/stats';
import { CHORE_XP } from '@/lib/chores/stats';
import './level-info.css';

type Props = {
  /** XP by where it came from. */
  sources: { questions: number; habits: number; chores: number };
  /** Question XP per week, oldest first (the last is this week). */
  weeks?: { week: string; xp: number }[];
  /** Shows a close button (when the panel was opened from a level badge). */
  onClose?: () => void;
};

const SOURCES = [
  { key: 'questions', icon: '🧠', label: 'Daily questions', href: '/daily' },
  { key: 'habits', icon: '✅', label: 'Habits', href: '/habits' },
  { key: 'chores', icon: '🧹', label: 'Chores', href: '/chores' },
] as const;

/**
 * What your profile level means: where the XP came from, how far to the next
 * level and title, every title on the way, and how each part of the site
 * earns XP.
 */
export default function LevelInfo({ sources, weeks, onClose }: Props) {
  const total = sources.questions + sources.habits + sources.chores;
  const level = levelFromXp(total);
  const title = nextTitle(level.level);
  // Question pace over the last four full weeks (this week isn't over).
  const recent = (weeks ?? []).slice(-5, -1);
  const pace = recent.length ? recent.reduce((s, w) => s + w.xp, 0) / recent.length : 0;
  const weeksTo = (xp: number) => (pace > 0 ? Math.ceil(xp / pace) : null);
  const toNext = weeksTo(level.toNext);
  const ranks = LEVEL_TITLES.map(([at, name], i) => ({ at, name, until: LEVEL_TITLES[i + 1] ? LEVEL_TITLES[i + 1][0] - 1 : null, xp: xpForLevel(at) }));

  return (
    <section className="lv-info" id="level" aria-labelledby="level-title">
      <div className="lv-title">
        <h3 id="level-title">🏅 Your level</h3>
        {onClose && <button type="button" className="lv-close" onClick={onClose} aria-label="Close level info">✕</button>}
      </div>
      <div className="lv-head">
        <span className="lv-badge">Lv {level.level}</span>
        <div>
          <strong>{level.title}</strong>
          <span className="lv-muted">{total.toLocaleString()} XP in all · {level.toNext.toLocaleString()} XP to level {level.level + 1}</span>
          {title && <span className="lv-muted">{title.title} at level {title.level} ({(title.xp - total).toLocaleString()} XP to go)</span>}
        </div>
      </div>
      <div className="lv-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.size} aria-valuenow={level.into}>
        <span style={{ width: `${(level.into / level.size) * 100}%` }} />
      </div>
      <p className="lv-muted">
        Level {level.level + 1} comes at {xpForLevel(level.level + 1).toLocaleString()} XP in all; each level takes 100 XP more than the one before.
        {toNext !== null && ` At your question pace (about ${Math.round(pace)} XP a week lately), the next level is ${toNext <= 1 ? 'about a week' : `about ${toNext} weeks`} away from questions alone.`}
      </p>

      <h4 className="lv-sub">Where your XP comes from</h4>
      <ul className="lv-sources">
        {SOURCES.map((s) => {
          const xp = sources[s.key];
          return (
            <li key={s.key}>
              <a href={s.href}><span aria-hidden>{s.icon}</span> {s.label}</a>
              <span className="lv-source-bar"><i style={{ width: `${total ? (xp / total) * 100 : 0}%` }} /></span>
              <strong>{xp.toLocaleString()}</strong>
              <small>{total ? Math.round((xp / total) * 100) : 0}%</small>
            </li>
          );
        })}
      </ul>

      <h4 className="lv-sub">Titles</h4>
      <ol className="lv-ranks">
        {ranks.map((r) => {
          const here = level.level >= r.at && (r.until === null || level.level <= r.until);
          return (
            <li key={r.name} className={here ? 'is-current' : level.level < r.at ? 'is-locked' : 'is-done'}>
              <strong>{r.name}</strong>
              <span>{r.until === null ? `level ${r.at}+` : r.until === r.at ? `level ${r.at}` : `levels ${r.at}–${r.until}`}</span>
              <small>{r.xp.toLocaleString()} XP{here ? ' · you' : ''}</small>
            </li>
          );
        })}
      </ol>

      <details className="lv-rules">
        <summary>How to earn XP</summary>
        <dl>
          <dt>🧠 Questions</dt>
          <dd>
            A full solve is worth {XP_RULES.base} + {XP_RULES.perDifficulty} × difficulty ({XP_RULES.base + XP_RULES.perDifficulty}–{XP_RULES.base + 5 * XP_RULES.perDifficulty} XP), with partial credit per part.
            Each hint −{Math.round(XP_RULES.hintCost * 100)}%, each extra check −{Math.round(XP_RULES.retryCost * 100)}% (up to {XP_RULES.maxTries}).
            A wrong answer still earns {XP_RULES.effort}, reading the worked solution {XP_RULES.studied}. Friday boss problems ×{XP_RULES.boss}; earlier days and Practice are half XP.
          </dd>
          <dt>✅ Habits</dt>
          <dd>
            {HABIT_XP.habit} per habit done, {HABIT_XP.perfectDay} more for a day with every habit done, {HABIT_XP.weeklyGoal} for hitting a weekly goal.
            Streak bonuses: {HABIT_XP.milestones.map(([len, bonus]) => `${len} → +${bonus}`).join(', ')}.
          </dd>
          <dt>🧹 Chores</dt>
          <dd>
            {CHORE_XP.effort.slice(1).join(' / ')} for quick / medium / big chores, +{CHORE_XP.onTime} when done by the due date.
            On-time streaks: {CHORE_XP.milestones.map(([len, bonus]) => `${len} in a row → +${bonus}`).join(', ')}.
          </dd>
        </dl>
      </details>
    </section>
  );
}
