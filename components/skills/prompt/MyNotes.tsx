'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { skillsGet, type Material } from '../api';

// "Use my notes": what you've written about the picked topics (notes in linked
// Reader books, the topic's Notes pages with their handwriting and recording
// transcripts), each one ticked in or out of the prompt.

const MAX_TOTAL = 40_000;

export default function MyNotes({ subjectId, topicIds, onChange }: { subjectId: string; topicIds: string[]; onChange: (material: Material[]) => void }) {
  const [found, setFound] = useState<Material[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState('');
  const key = topicIds.join(',');

  useEffect(() => {
    if (!key) { setFound([]); return; }
    let live = true;
    setFound(null);
    skillsGet<{ material: Material[] }>({ material: '1', subject: subjectId, topics: key })
      .then((body) => { if (live) { setFound(body.material); setProblem(''); } })
      .catch((e) => { if (live) { setFound([]); setProblem(e instanceof Error ? e.message : 'Couldn’t gather your notes.'); } });
    return () => { live = false; };
  }, [subjectId, key]);

  // Ticked sources, oldest-first order kept, stopping before the prompt gets too long to paste.
  useEffect(() => {
    let room = MAX_TOTAL;
    onChange((found ?? []).filter((m) => !off.has(m.id)).filter((m) => (room -= m.text.length) >= 0));
  }, [found, off, onChange]);

  const total = (found ?? []).filter((m) => !off.has(m.id)).reduce((s, m) => s + m.text.length, 0);

  return (
    <section className="sk-card sk-my-notes">
      <h2>Use my notes</h2>
      {!found ? <p className="sk-hint">Looking through your Reader and Notes…</p> : !found.length ? (
        <p className="sk-hint">
          Nothing written on these topics yet. Notes in a book you’ve linked from the Reader (on the Resources tab), and Notes pages tied to a topic (on the Topics tab), show up here, handwriting and recordings included.
        </p>
      ) : (
        <>
          <p className="sk-hint">Ticked notes go into the prompt, so the questions test what you chose to write down.</p>
          <ul className="sk-material">
            {found.map((m) => (
              <li key={m.id}>
                <label>
                  <input type="checkbox" checked={!off.has(m.id)} onChange={(e) => { const next = new Set(off); if (e.target.checked) next.delete(m.id); else next.add(m.id); setOff(next); }} />
                  <span>{m.kind === 'book' ? '📖' : '✏️'} {m.label}</span>
                  <small>{m.text.length.toLocaleString()} characters</small>
                </label>
                <details><summary>Show</summary><pre>{m.text}</pre></details>
              </li>
            ))}
          </ul>
          {total > MAX_TOTAL && <p className="sk-warning">That’s more than fits comfortably in one prompt, so the last ticked ones are left out. Untick some, or pick fewer topics.</p>}
        </>
      )}
      {problem && <p className="sk-warning">{problem}</p>}
      <p className="sk-hint"><Link href={`/skills/${subjectId}?tab=topics`}>Tie Notes pages to topics</Link></p>
    </section>
  );
}
