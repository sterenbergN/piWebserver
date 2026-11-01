'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { ListEditor } from '@/components/study/ListEditor';
import { EmptyState, Loading } from '@/components/study/Ui';
import { BLUEPRINT } from '@/lib/study/coverage';
import type { DiffCase, DiffPlay } from '@/lib/study/practice';

// Every Differential case, answers showing, to fix or remove. That would spoil the
// ones she hasn't played, so nothing is fetched until she says go ahead.

function CaseEditor({ puzzle, onDone, onCancel, onRemove }: { puzzle: DiffCase; onDone: () => Promise<void>; onCancel: () => void; onRemove: () => void }) {
  const [answer, setAnswer] = useState(puzzle.answer);
  const [clues, setClues] = useState(puzzle.clues);
  const [options, setOptions] = useState(() => puzzle.options.filter((o) => o !== puzzle.answer).map((text) => ({ text })));
  const [explanation, setExplanation] = useState(puzzle.explanation);
  const [topic, setTopic] = useState(puzzle.topic);
  const [system, setSystem] = useState<string>(puzzle.system ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await practicePost('edit-puzzle', { id: puzzle.id, answer, clues, options: options.map((o) => o.text), explanation, topic, system });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="ed-question">
      <div className="sd-fields">
        <label className="sd-wide">The answer
          <input value={answer} maxLength={120} onChange={(e) => setAnswer(e.target.value)} />
        </label>
      </div>
      <ListEditor title="Clues" hint="3 to 6, from vague to specific." items={clues} addLabel="Add a clue" max={6} blank={{ label: '', text: '' }} onChange={setClues}
        fields={[{ key: 'label', label: 'Kind of clue', placeholder: 'History' }, { key: 'text', label: 'Clue', placeholder: 'Flew home from overseas yesterday.', rows: 2 }]} />
      <ListEditor title="Other diagnoses to choose from" hint="At least 3." items={options} addLabel="Add a diagnosis" max={7} blank={{ text: '' }} onChange={setOptions}
        fields={[{ key: 'text', label: 'Diagnosis', placeholder: 'Pneumonia' }]} />
      <div className="sd-fields">
        <label className="sd-wide">Explanation
          <textarea rows={3} value={explanation} maxLength={2000} onChange={(e) => setExplanation(e.target.value)} />
        </label>
        <label>Topic
          <input value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label>Organ system
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">None</option>
            {BLUEPRINT.map((b) => <option key={b.system} value={b.system}>{b.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="hb-text-btn sd-danger-link ed-push" disabled={busy} onClick={onRemove}>Remove this case</button>
      </div>
    </div>
  );
}

export default function DifferentialCasesPage() {
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'gate' | 'loading' | 'ready' | 'signed-out' | 'error'>('gate');
  const [puzzles, setPuzzles] = useState<DiffCase[]>([]);
  const [plays, setPlays] = useState<Record<string, DiffPlay>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const body = await practiceGet<{ puzzles: DiffCase[]; plays: Record<string, DiffPlay> }>('puzzles=1');
    setPuzzles(body.puzzles);
    setPlays(body.plays);
    setState('ready');
  }, []);

  const head = (
    <header className="sd-head">
      <div>
        <Link className="sd-back" href="/study/games/differential"><Icon name="left" /> Differential</Link>
        <h1>Your cases</h1>
      </div>
    </header>
  );
  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to edit your cases">These are your own cases.</SignInPrompt></div>;
  if (state === 'gate') {
    return (
      <div className="sd sd-narrow animate-fade-in">
        {head}
        <EmptyState icon="alert" title="This will spoil what you haven’t played">
          The list shows every case with its answer.
        </EmptyState>
        <div className="sd-actions ed-center">
          <Link className="btn btn-secondary" href="/study/games/differential">Never mind</Link>
          <button type="button" className="btn btn-primary" onClick={() => { setState('loading'); load().catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error')); }}>Show the cases</button>
        </div>
      </div>
    );
  }
  const remove = async (puzzle: DiffCase) => {
    const ok = await confirm({ title: 'Remove this case?', message: `“${puzzle.answer}” goes from your cases. Your streak and scores stay.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    setError('');
    try {
      await practicePost('delete-puzzle', { id: puzzle.id });
      await load();
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t remove it.');
    }
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      {head}
      {state === 'loading' && <Loading rows={2} />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your cases.</span></div>}
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
      {state === 'ready' && (puzzles.length ? (
        <section className="sd-card">
          <ul className="ed-list">
            {puzzles.map((puzzle) => (
              <li key={puzzle.id} className={open === puzzle.id ? 'is-open' : ''}>
                {open === puzzle.id ? (
                  <CaseEditor puzzle={puzzle} onCancel={() => setOpen(null)} onRemove={() => remove(puzzle)} onDone={async () => { await load(); setOpen(null); }} />
                ) : (
                  <>
                    <span className="ed-summary">
                      <span className="ed-stem">{puzzle.answer}</span>
                      <small>{[puzzle.topic, `${puzzle.clues.length} clues`, plays[puzzle.id] ? 'played' : 'not played yet'].join(' · ')}</small>
                    </span>
                    <button type="button" className="hb-small-btn" aria-label={`Edit ${puzzle.answer}`} onClick={() => setOpen(puzzle.id)}><Icon name="pencil" /> Edit</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState icon="search" title="No cases yet" action={{ href: '/study/practice/add?kind=puzzle', label: 'Add cases' }}>Your AI writes these from your notes.</EmptyState>
      ))}
    </div>
  );
}
