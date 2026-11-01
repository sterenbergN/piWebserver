'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { CopyPrompt, PasteReply } from '@/components/study/PromptSteps';
import { parseCaseReply, parseDiffReply, parseGridReply } from '@/lib/study/practice';
import { buildCasePrompt, buildDifferentialPrompt, buildGridPrompt } from '@/lib/study/prompt';
import { StudyInputError } from '@/lib/study/study';

// Grids, mock patients and Differential cases all arrive the way tests do: copy a
// prompt into her AI with her notes, then paste back what it wrote. The reply is
// checked as it's pasted, so a problem shows before anything is saved.

const KINDS = {
  grid: {
    title: 'Make a comparison grid', back: '/study/practice', backLabel: 'Practice', action: 'add-grids', counts: [4, 6, 8, 10, 12], countLabel: 'Rows', count: 6, one: 'grid', many: 'grids',
    subjectLabel: 'What to compare', subjectHint: 'Antiarrhythmic classes, or murmurs', save: 'Save and open it',
  },
  case: {
    title: 'Add mock patients', back: '/study/practice', backLabel: 'Practice', action: 'add-cases', counts: [1, 2, 3, 5], countLabel: 'Cases', count: 2, one: 'case', many: 'cases',
    subjectLabel: 'What to practice (optional)', subjectHint: 'Chest pain and shortness of breath', save: 'Save the cases',
  },
  puzzle: {
    title: 'Add Differential cases', back: '/study/games/differential', backLabel: 'Differential', action: 'add-puzzles', counts: [5, 10, 15, 20, 30], countLabel: 'Cases', count: 10, one: 'case', many: 'cases',
    subjectLabel: 'What to cover (optional)', subjectHint: 'Causes of shortness of breath', save: 'Save the cases',
  },
} as const;
type Kind = keyof typeof KINDS;

function readAny(kind: Kind, text: string): { found?: string[]; problems?: string[]; error?: string } {
  if (!text.trim()) return {};
  try {
    if (kind === 'grid') {
      const { items, problems } = parseGridReply(text);
      return { found: items.map((g) => `${g.title}: ${g.rows.length} rows, ${g.columns.length} columns`), problems };
    }
    if (kind === 'case') {
      const { items, problems } = parseCaseReply(text);
      // Not the diagnosis: she's about to practice these.
      return { found: items.map((c) => `${c.title}: ${c.script.length} answers, ${c.checklist.length} checklist items`), problems };
    }
    const { items, problems } = parseDiffReply(text);
    return { found: [`${items.length} case${items.length === 1 ? '' : 's'}, with what the answers are kept hidden`], problems };
  } catch (error) {
    return { error: error instanceof StudyInputError ? error.message : 'That couldn’t be read.' };
  }
}

function AddPractice() {
  const router = useRouter();
  const wanted = useSearchParams().get('kind');
  const kind: Kind = wanted === 'case' || wanted === 'puzzle' ? wanted : 'grid';
  const info = KINDS[kind];
  const [signedOut, setSignedOut] = useState(false);
  const [used, setUsed] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [course, setCourse] = useState('');
  const [count, setCount] = useState<number>(info.count);
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    practiceGet<{ used: string[] }>('differential=1').then((body) => setUsed(body.used)).catch((error) => { if (error instanceof SignedOut) setSignedOut(true); });
  }, []);

  const prompt = useMemo(() => {
    if (kind === 'grid') return buildGridPrompt({ subject, course, rows: count });
    if (kind === 'case') return buildCasePrompt({ subject, course, count });
    return buildDifferentialPrompt({ subject, count, used });
  }, [kind, subject, course, count, used]);
  const parsed = useMemo(() => readAny(kind, reply), [kind, reply]);

  async function save() {
    if (!parsed.found || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const body = await practicePost<{ id?: string }>(info.action, { text: reply });
      router.push(kind === 'grid' && body.id ? `/study/practice/grids/${body.id}` : info.back);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t save that.');
      setSaving(false);
    }
  }

  if (signedOut) return <div className="sd"><SignInPrompt title="Sign in to add these">They’re only shown to your account.</SignInPrompt></div>;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href={info.back}>← {info.backLabel}</Link>
          <h1>{info.title}</h1>
        </div>
      </header>

      <CopyPrompt prompt={prompt}>
        <div className="sd-fields">
          <label className="sd-wide">{info.subjectLabel}
            <input value={subject} maxLength={200} placeholder={info.subjectHint} onChange={(e) => setSubject(e.target.value)} />
          </label>
          {kind !== 'puzzle' && (
            <label>Class or module
              <input value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
            </label>
          )}
          <label>{info.countLabel}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {info.counts.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {kind !== 'grid' && <p className="hb-hint">These are made-up patients. Don’t paste in details from anyone real.</p>}
        {kind === 'puzzle' && used.length > 0 && <p className="hb-hint">The prompt asks it not to repeat the {used.length} diagnos{used.length === 1 ? 'is' : 'es'} you already have.</p>}
      </CopyPrompt>

      <PasteReply value={reply} onChange={(text) => { setReply(text); setSaveError(''); }}>
        {parsed.error && <div className="hb-banner is-error" role="alert"><span>{parsed.error}</span></div>}
        {parsed.found && (
          <div className="sd-preview">
            <div className="sd-found">
              <strong>Ready to save:</strong>
              <ul>{parsed.found.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
            {!!parsed.problems?.length && (
              <details className="sd-problems" open={parsed.problems.length <= 3}>
                <summary>{parsed.problems.length} couldn’t be used</summary>
                <ul>{parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            {saveError && <div className="hb-banner is-error" role="alert"><span>{saveError}</span></div>}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : info.save}</button>
          </div>
        )}
      </PasteReply>
    </div>
  );
}

export default function AddPracticePage() {
  return <Suspense><AddPractice /></Suspense>;
}
