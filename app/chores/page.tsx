'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import ChoreCard from '@/components/chores/ChoreCard';
import ChoreEditor, { CHORE_TEMPLATES } from '@/components/chores/ChoreEditor';
import { useChores, type Member } from '@/components/chores/useChores';
import Confetti from '@/components/habits/Confetti';
import { Plant } from '@/components/habits/Garden';
import { habitColor } from '@/components/habits/HabitCard';
import { habitsXpElsewhere, questionsXpElsewhere } from '@/components/progress/otherXp';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { applyChoreAction, isOpen, type Chore, type ChoreInput, type ChoresData } from '@/lib/chores/chores';
import { byUrgency, choreXp, chorePlant, dueStatus, entryXp, recentEntries, weekBoard, type DueStatus } from '@/lib/chores/stats';
import { levelFromXp } from '@/lib/progress/levels';
import LevelInfo from '@/components/progress/LevelInfo';
import '../habits/habits.css';
import './chores.css';

const TABS = [
  { id: 'list', icon: '🧹', label: 'To do' },
  { id: 'garden', icon: '🌱', label: 'Garden' },
  { id: 'home', icon: '🏠', label: 'Household' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const GROUPS: { status: DueStatus[]; title: string }[] = [
  { status: ['overdue'], title: 'Overdue' },
  { status: ['today'], title: 'Today' },
  { status: ['soon'], title: 'This week' },
  { status: ['later'], title: 'Later' },
  { status: ['anytime'], title: 'Whenever' },
];

const MOOD_TEXT = { thriving: '🌞 On top of it', okay: '🌤 A little late', wilting: '🥀 Overdue' };

const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

export default function ChoresPage() {
  const c = useChores();
  const { data, today, household } = c;
  const me = household?.me ?? null;
  const members = household?.members ?? [];
  const { confirm, popup } = useSitePopup();
  const [tab, setTab] = useState<TabId>('list');
  const [editing, setEditing] = useState<Chore | 'new' | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [toast, setToast] = useState('');
  const ready = c.mode === 'account' || c.mode === 'device';

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === id)) setTab(id as TabId);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const chooseTab = (id: TabId) => { setTab(id); history.replaceState(history.state, '', `#${id}`); };

  // The profile level also counts habits and daily questions.
  const [otherXp, setOtherXp] = useState<{ habits: number; questions: number } | null>(null);
  useEffect(() => {
    if (ready) Promise.all([habitsXpElsewhere(), questionsXpElsewhere()]).then(([habits, questions]) => setOtherXp({ habits, questions }));
  }, [ready]);
  const xpSources = { questions: otherXp?.questions ?? 0, habits: otherXp?.habits ?? 0, chores: choreXp(data, me) };
  const level = levelFromXp(xpSources.questions + xpSources.habits + xpSources.chores);
  /** The level panel, opened from the level badge (or /chores#level). */
  const [showLevel, setShowLevel] = useState(false);
  useEffect(() => { if (window.location.hash === '#level') setShowLevel(true); }, []);

  // Confetti on a level up, but not for the level the page opened at.
  const seenLevel = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || otherXp === null) return;
    if (seenLevel.current !== null && level.level > seenLevel.current) {
      setConfetti(Date.now());
      setToast(`Level ${level.level}! You’re a ${level.title.toLowerCase()} now.`);
    }
    seenLevel.current = level.level;
  }, [level.level, level.title, ready, otherXp]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = data.chores.filter(isOpen);
  const shown = mineOnly ? open.filter((x) => !x.assignee || x.assignee === me) : open;
  const groups = GROUPS.map((g) => ({ ...g, chores: byUrgency(shown.filter((x) => g.status.includes(dueStatus(x, today).status))) })).filter((g) => g.chores.length);
  const finished = data.chores.filter((x) => !isOpen(x)).sort((a, b) => (b.archivedOn ?? '').localeCompare(a.archivedOn ?? ''));
  const overdue = open.filter((x) => dueStatus(x, today).status === 'overdue').length;
  const board = useMemo(() => weekBoard(data, today, members.map((m) => m.id)), [data, today, members]);
  const nameOf = (id: string | null) => (id === me ? 'You' : members.find((m) => m.id === id)?.name ?? 'Someone');

  const markDone = (chore: Chore) => {
    const entryId = Math.random().toString(36).slice(2, 12);
    const action = { type: 'done', id: chore.id, date: today, entryId } as const;
    // What it earns, worked out on a copy (streak bonuses depend on the whole log).
    let xp = 0;
    try { xp = entryXp(applyChoreAction(structuredClone(data), action, today, () => entryId), entryId); } catch { /* dispatch reports it */ }
    if (!c.dispatch(action)) return;
    vibrate(30);
    setToast(`+${xp} XP · ${chore.name}`);
  };

  const save = (input: ChoreInput) => c.dispatch({ type: 'save', chore: editing && editing !== 'new' ? { ...input, id: editing.id } : input });
  const remove = async (chore: Chore) => {
    const ok = await confirm({ title: `Delete “${chore.name}”?`, message: 'It and its history go for good, and the XP from it goes too. To keep the XP, mark it done or change its schedule instead.', confirmLabel: 'Delete', danger: true });
    if (ok && c.dispatch({ type: 'delete', id: chore.id })) setEditing(null);
  };
  const signIn = () => window.dispatchEvent(new Event('site:sign-in'));

  const card = (chore: Chore) => (
    <ChoreCard key={chore.id} chore={chore} data={data} today={today} members={members} me={me}
      onDone={() => markDone(chore)}
      onSkip={() => c.dispatch({ type: 'skip', id: chore.id, date: today })}
      onUndo={(entryId) => c.dispatch({ type: 'undo', entryId })}
      onEdit={() => setEditing(chore)} />
  );

  return (
    <div className="hb ch animate-fade-in">
      <Confetti fire={confetti} />
      {popup}

      <header className="hb-head">
        <div>
          <h1>Chores</h1>
          <p>Keep the house running together. Every chore grows its plant.</p>
        </div>
        {ready && (
          <button type="button" className="hb-level hb-level-btn" aria-expanded={showLevel} aria-controls="level"
            title={`${level.xp} XP total. Tap for what your level means.`} onClick={() => setShowLevel((v) => !v)}>
            <span className="hb-level-badge">Lv {level.level}</span>
            <div className="hb-level-text">
              <strong>{level.title}</strong>
              <div className="hb-level-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.size} aria-valuenow={level.into}>
                <span style={{ width: `${(level.into / level.size) * 100}%` }} />
              </div>
              <small>{level.into} / {level.size} XP to level {level.level + 1}</small>
            </div>
            <span className="hb-level-more" aria-hidden>{showLevel ? '▲' : 'ⓘ'}</span>
          </button>
        )}
      </header>

      {showLevel && ready && <LevelInfo sources={xpSources} onClose={() => setShowLevel(false)} />}

      {c.mode === 'device' && (
        <div className="hb-banner">
          <span>Saved on this device only. Sign in to share the list with your household.</span>
          <button type="button" className="hb-small-btn" onClick={signIn}>Sign in</button>
        </div>
      )}
      {c.deviceData && (
        <div className="hb-banner">
          <span>{c.deviceData.chores.length} chore{c.deviceData.chores.length === 1 ? ' is' : 's are'} saved on this device from before you signed in.</span>
          <button type="button" className="hb-small-btn is-primary" onClick={c.importDevice}>Add to the household</button>
          <button type="button" className="hb-small-btn" onClick={c.dismissDevice}>Discard</button>
        </div>
      )}
      {c.error && (
        <div className="hb-banner is-error" role="alert">
          <span>{c.error}</span>
          <button type="button" className="hb-small-btn" onClick={c.clearError}>OK</button>
        </div>
      )}
      {c.mode === 'loading' && <p className="hb-hint">Loading chores…</p>}
      {c.mode === 'error' && (
        <div className="hb-banner is-error">
          <span>Couldn’t load your chores.</span>
          <button type="button" className="hb-small-btn" onClick={() => c.reload()}>Try again</button>
        </div>
      )}

      {ready && (
        <>
          <div className="hb-tabs" role="tablist" aria-label="Chores">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => chooseTab(t.id)}>
                <span aria-hidden>{t.icon}</span>{t.label}{t.id === 'list' && overdue > 0 && <span className="ch-badge" aria-label={`${overdue} overdue`}>{overdue}</span>}
              </button>
            ))}
          </div>

          {tab === 'list' && (open.length === 0 ? (
            <section className="hb-empty">
              <h2>What needs doing around the house?</h2>
              <p className="hb-hint">Tap a few to add them (each starts due today), or make your own. Dates and how often are easy to change.</p>
              <div className="hb-template-grid">
                {CHORE_TEMPLATES.map((t) => (
                  <button key={t.name} type="button" className="hb-template" onClick={() => c.dispatch({ type: 'save', chore: { fromDone: true, ...t, due: t.repeat ? today : null } })}>
                    <span aria-hidden>{t.emoji}</span>{t.name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Make your own</button>
            </section>
          ) : (
            <section>
              {members.length > 1 && (
                <div className="ch-board" aria-label="This week">
                  <span className="ch-board-title">This week</span>
                  {board.map((row, i) => (
                    <span key={row.member} className={`ch-board-row${i === 0 && row.xp > 0 ? ' is-lead' : ''}`}>
                      {i === 0 && row.xp > 0 ? '👑 ' : ''}<strong>{nameOf(row.member)}</strong> {row.xp} XP<small> · {row.count} done</small>
                    </span>
                  ))}
                </div>
              )}
              {members.length > 1 && (
                <div className="hb-seg ch-filter" role="radiogroup" aria-label="Show">
                  <button type="button" role="radio" aria-checked={!mineOnly} onClick={() => setMineOnly(false)}>Everything</button>
                  <button type="button" role="radio" aria-checked={mineOnly} onClick={() => setMineOnly(true)}>Mine &amp; anyone’s</button>
                </div>
              )}

              {groups.map((g) => (
                <div key={g.title} className={`ch-group is-${g.status[0]}`}>
                  <h2 className="ch-group-title">{g.title} <span>{g.chores.length}</span></h2>
                  <div className="hb-list">{g.chores.map(card)}</div>
                </div>
              ))}
              {!groups.length && <p className="hb-hint">Nothing for you right now.</p>}

              {finished.length > 0 && (
                <details className="hb-rest">
                  <summary>Done one-offs ({finished.length})</summary>
                  <ul className="ch-finished">
                    {finished.slice(0, 30).map((x) => (
                      <li key={x.id} style={habitColor(x)}>
                        <span aria-hidden>{x.emoji}</span>
                        <button type="button" className="ch-name" onClick={() => setEditing(x)}>{x.name}</button>
                        <span className="hb-meta">{x.archivedOn ? fmtDay(x.archivedOn, { month: 'short', day: 'numeric' }) : ''}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="hb-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing('new')}>+ New chore</button>
              </div>
              <p className="hb-hint hb-howto">
                Hold a circle when a chore’s done; its next due date moves on by itself. Tap a name to change it.
              </p>
            </section>
          ))}

          {tab === 'garden' && <ChoreGarden chores={open.filter((x) => x.repeat)} data={data} today={today} />}

          {tab === 'home' && (
            <HouseholdTab mode={c.mode} data={data} today={today} members={members} me={me} invite={household?.invite ?? null}
              op={c.householdOp} confirm={confirm} signIn={signIn} nameOf={nameOf} />
          )}
        </>
      )}

      {toast && <div className="hb-toast" role="status">{toast}</div>}

      {editing && (
        <ChoreEditor chore={editing === 'new' ? null : editing} today={today} members={members} me={me}
          onSave={save} onClose={() => setEditing(null)}
          onDelete={editing !== 'new' ? () => remove(editing) : undefined}
          onRestore={editing !== 'new' ? () => c.dispatch({ type: 'archive', id: editing.id, archived: false }) : undefined} />
      )}
    </div>
  );
}

function ChoreGarden({ chores, data, today }: { chores: Chore[]; data: ChoresData; today: DateKey }) {
  if (!chores.length) return <p className="hb-hint">Add a repeating chore to plant your first seed.</p>;
  return (
    <>
      <p className="hb-hint hb-garden-intro">
        Each repeating chore is a plant, shared by the household. Every time it’s done it grows; let it go overdue and it wilts until someone gets to it.
      </p>
      <ul className="hb-garden">
        {chores.map((chore) => {
          const plant = chorePlant(chore, data, today);
          const share = plant.nextAt === null ? 1 : (plant.total - plant.stageAt) / (plant.nextAt - plant.stageAt);
          return (
            <li key={chore.id} className="hb-plant" style={habitColor(chore)}>
              <Plant stage={plant.stage} mood={plant.mood} watered={plant.wateredToday}
                label={`${chore.name}: ${plant.stageName}, ${MOOD_TEXT[plant.mood].slice(2).toLowerCase()}`} />
              <strong><span aria-hidden>{chore.emoji}</span> {chore.name}</strong>
              <span className="hb-plant-stage">{plant.stageName}</span>
              <span className="hb-plant-mood">{MOOD_TEXT[plant.mood]}</span>
              <div className="hb-plant-bar" aria-hidden><span style={{ width: `${Math.round(share * 100)}%` }} /></div>
              <span className="hb-meta">
                Done {plant.total} time{plant.total === 1 ? '' : 's'}{plant.nextAt !== null ? ` · ${plant.nextAt - plant.total} to grow` : ' · fully grown'}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

type HouseholdProps = {
  mode: string;
  data: ChoresData;
  today: DateKey;
  members: Member[];
  me: string | null;
  invite: string | null;
  op: (op: 'invite' | 'invite-off' | 'join' | 'leave', code?: string) => Promise<boolean>;
  confirm: ReturnType<typeof useSitePopup>['confirm'];
  signIn: () => void;
  nameOf: (id: string | null) => string;
};

function HouseholdTab({ mode, data, today, members, me, invite, op, confirm, signIn, nameOf }: HouseholdProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const recent = recentEntries(data, today, 14);
  const byId = new Map(data.chores.map((x) => [x.id, x]));

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const join = () => run(async () => {
    const mineCount = data.chores.length;
    const ok = await confirm({
      title: 'Join this household?',
      message: members.length > 1
        ? 'You’ll leave your current household; its chores stay with the others in it.'
        : mineCount ? `Your ${mineCount} chore${mineCount === 1 ? '' : 's'} and their history move into the household you join.` : 'You’ll share one chore list with everyone in it.',
      confirmLabel: 'Join',
    });
    if (ok && await op('join', code)) setCode('');
  });
  const leave = () => run(async () => {
    const ok = await confirm({ title: 'Leave the household?', message: 'The chores stay with everyone else. You start a new, empty list of your own.', confirmLabel: 'Leave', danger: true });
    if (ok) await op('leave');
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select it by hand */ }
  };

  return (
    <>
      {mode === 'device' ? (
        <section className="hb-panel">
          <h3>Share chores with your household</h3>
          <p className="hb-hint">Sign in, and everyone you invite sees the same list, ticks things off and earns their own XP.</p>
          <button type="button" className="btn btn-primary" onClick={signIn}>Sign in</button>
        </section>
      ) : (
        <>
          <section className="hb-panel">
            <h3>Who’s in</h3>
            <ul className="ch-members">
              {members.map((m) => (
                <li key={m.id}><span className="nav-avatar" aria-hidden>{m.name.slice(0, 1).toUpperCase()}</span>{m.name}{m.id === me ? ' (you)' : ''}</li>
              ))}
            </ul>
            {members.length > 1 && <button type="button" className="hb-text-btn ch-leave" disabled={busy} onClick={leave}>Leave this household</button>}
          </section>

          <section className="hb-panel">
            <h3>Invite someone</h3>
            {invite ? (
              <>
                <div className="ch-code" aria-label={`Invite code ${invite.split('').join(' ')}`}>{invite}</div>
                <p className="hb-hint">They sign in with their own account, open <strong>Chores → Household</strong> and enter this code. It keeps working until you turn it off.</p>
                <div className="ch-code-actions">
                  <button type="button" className="hb-small-btn is-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy code'}</button>
                  <button type="button" className="hb-small-btn" disabled={busy} onClick={() => run(() => op('invite'))}>New code</button>
                  <button type="button" className="hb-small-btn" disabled={busy} onClick={() => run(() => op('invite-off'))}>Turn off</button>
                </div>
              </>
            ) : (
              <>
                <p className="hb-hint">Make a code for someone with an account on this site (accounts are made by Noah).</p>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => op('invite'))}>Make an invite code</button>
              </>
            )}
          </section>

          <section className="hb-panel">
            <h3>Join a household</h3>
            <form className="ch-join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) join(); }}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="Code" aria-label="Invite code"
                autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn btn-secondary" disabled={busy || code.replace(/\W/g, '').length < 6}>Join</button>
            </form>
          </section>
        </>
      )}

      <section className="hb-panel">
        <h3>Last two weeks</h3>
        {recent.length === 0 ? <p className="hb-hint">Nothing done yet. The first chore you check off shows up here.</p> : (
          <ul className="ch-activity">
            {recent.slice(0, 40).map((e) => {
              const chore = byId.get(e.choreId);
              const xp = e.skipped ? 0 : entryXp(data, e.id);
              return (
                <li key={e.id} className={e.skipped ? 'is-skipped' : ''}>
                  <span className="ch-activity-day">{e.date === today ? 'Today' : e.date === addDays(today, -1) ? 'Yesterday' : fmtDay(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span aria-hidden>{chore?.emoji ?? '🧹'}</span>
                  <span className="ch-activity-text">
                    {members.length > 1 && <strong>{nameOf(e.by)} </strong>}
                    {e.skipped ? 'skipped ' : members.length > 1 ? 'did ' : ''}{chore?.name ?? 'a chore'}
                  </span>
                  {xp > 0 && <span className="ch-activity-xp">+{xp}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
