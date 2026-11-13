'use client';

import { useEffect, useState } from 'react';
import type { Topic } from '@/lib/skills/types';
import { skillsGet, type NotesPageView } from '../api';
import type { useAct } from './shared';

// A topic's pages in Notes: open them, start a new one (made in the Skills
// notebook with the topic at the top and a link back here), or tie a page you
// already have. Pages open in a tab of their own, like the daily questions'.

type Act = ReturnType<typeof useAct>['act'];
type Choice = { notebook: string; title: string; pages: { page: string; number: number; title?: string }[] };

export default function TopicNotes({ topic, pages, act, busy }: { topic: Topic; pages: NotesPageView[]; act: Act; busy: boolean }) {
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState('');
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [notebook, setNotebook] = useState('');

  useEffect(() => {
    if (!picking || choices) return;
    let live = true;
    skillsGet<{ notebooks: Choice[] }>({ notesPages: '1' })
      .then((body) => { if (live) setChoices(body.notebooks); })
      .catch((e) => { if (live) setProblem(e instanceof Error ? e.message : 'Couldn’t load your notebooks.'); });
    return () => { live = false; };
  }, [picking, choices]);

  // Made on the account and listed here once it's ready, to open on whichever device you write on.
  async function makePage() {
    setMaking(true);
    await act('topic-notes-new', { topicId: topic.id });
    setMaking(false);
  }

  const taken = new Set(pages.map((p) => p.page));
  const book = choices?.find((c) => c.notebook === notebook);

  return (
    <div className="sk-topic-notes">
      {pages.length > 0 && (
        <ul className="sk-topic-pages">
          {pages.map((p) => (
            <li key={p.page}>
              <a href={p.href} target="_blank" rel="noopener">✏️ {p.label} ↗</a>
              <button type="button" className="sk-text-btn" disabled={busy} aria-label={`Untie ${p.label}`} onClick={() => act('topic-notes-untie', { topicId: topic.id, page: p.page })}>Untie</button>
            </li>
          ))}
        </ul>
      )}
      {!picking ? (
        <div className="sk-actions">
          <button type="button" className="sk-small-btn" disabled={making || busy} onClick={makePage}>{making ? 'Making the page…' : '✏️ New notes page'}</button>
          <button type="button" className="sk-text-btn" onClick={() => setPicking(true)}>Tie a page I have</button>
        </div>
      ) : (
        <div className="sk-topic-pick">
          {!choices ? <p className="sk-hint">Loading your notebooks…</p> : !choices.length ? <p className="sk-hint">You have no notebooks yet.</p> : (
            <>
              <label className="sk-field"><span>Notebook</span>
                <select value={notebook} onChange={(e) => setNotebook(e.target.value)}>
                  <option value="">Choose…</option>
                  {choices.map((c) => <option key={c.notebook} value={c.notebook}>{c.title}</option>)}
                </select>
              </label>
              {book && (
                <label className="sk-field"><span>Page</span>
                  <select defaultValue="" disabled={busy} onChange={async (e) => {
                    if (!e.target.value) return;
                    if (await act('topic-notes-tie', { topicId: topic.id, notebook: book.notebook, page: e.target.value })) setPicking(false);
                  }}>
                    <option value="">Choose…</option>
                    {book.pages.filter((p) => !taken.has(p.page)).map((p) => <option key={p.page} value={p.page}>Page {p.number}{p.title ? `: ${p.title}` : ''}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          <button type="button" className="sk-text-btn" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      )}
      {problem && <p className="sk-warning" role="alert">{problem}</p>}
    </div>
  );
}
