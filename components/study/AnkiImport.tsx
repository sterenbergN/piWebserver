'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { BLUEPRINT } from '@/lib/study/coverage';
import type { DeckRow } from '@/lib/study/coverage';
import type { MapResponse } from './MapTypes';

// Bringing her Anki decks in: the export steps, the upload, matching decks to
// organ systems, and the cards she keeps forgetting. Anki has no live link, so
// she imports again whenever she wants the map brought up to date.

const MAX_BYTES = 95 * 1024 * 1024;
const TOO_BIG = 'That file is too large, which usually means it has media in it. Export again with “Include media” turned off.';

function send(file: File, onProgress: (percent: number) => void) {
  return new Promise<{ success?: boolean; message?: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); });
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('The server didn’t answer properly. Try again.')); }
    });
    xhr.addEventListener('error', () => reject(new Error('The upload didn’t get through. Check your connection and try again.')));
    xhr.open('POST', '/api/study/anki/import');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.send(file);
  });
}

function MatchSelect({ label, value, saving, onChange }: { label: string; value: string; saving: boolean; onChange: (value: string) => void }) {
  return (
    <select aria-label={label} value={value} disabled={saving} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not matched</option>
      {BLUEPRINT.map((b) => <option key={b.system} value={b.system}>{b.label}</option>)}
      <option value="skip">Not on the PANCE (skip)</option>
    </select>
  );
}

function DeckLine({ deck, saving, onMatch }: { deck: DeckRow; saving: boolean; onMatch: (name: string, value: string) => void }) {
  const short = deck.name.split('::').pop();
  return (
    <li className="sd-match" style={{ paddingLeft: `${Math.min(deck.depth, 4) * 0.9}rem` }}>
      <span className="sd-test-main">
        <strong>{short}</strong>
        <small>{deck.cards.toLocaleString()} card{deck.cards === 1 ? '' : 's'}, {deck.reviewed.toLocaleString()} reviewed{deck.match && !deck.saved ? ' · suggested' : ''}</small>
      </span>
      <MatchSelect label={`Organ system for ${deck.name}`} value={deck.match ?? ''} saving={saving} onChange={(value) => onMatch(deck.name, value)} />
    </li>
  );
}

export default function AnkiImport({ onChanged }: { onChanged?: () => void }) {
  const { confirm, popup } = useSitePopup();
  const [data, setData] = useState<MapResponse['anki'] | undefined>(undefined);
  const [progress, setProgress] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/study/map', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t load your Anki decks.');
    setData(body.anki);
  }, []);
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load your Anki decks.')); }, [load]);

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    if (!/\.(apkg|colpkg)$/i.test(file.name)) { setError('That isn’t an Anki export. In Anki, use File → Export and choose “Anki Deck Package”, which makes an .apkg file.'); return; }
    if (file.size > MAX_BYTES) { setError(TOO_BIG); return; }
    setProgress(0);
    try {
      const body = await send(file, (percent) => {
        setProgress(percent);
        if (percent >= 100) setReading(true);
      });
      if (!body.success) throw new Error(body.message || 'Couldn’t read that file.');
      await load();
      onChanged?.();
      setNotice('Your decks are in.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.');
    } finally {
      setProgress(null);
      setReading(false);
    }
  };

  const match = async (kind: 'deck' | 'tag', name: string, value: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/study/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'match', kind, name, value: value || null }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That didn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Remove your Anki numbers?', message: 'The counts from your export leave the map. Your decks in Anki aren’t touched, and you can import again any time.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await fetch('/api/study/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove-anki' }) });
    await load();
    onChanged?.();
  };

  const busy = progress !== null;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <>
      {popup}
      <section className="sd-card">
        <h2>Bring your decks in</h2>
        {data ? (
          <p className="hb-hint">{data.cards.toLocaleString()} cards from {data.fileName}, imported {fmt(data.importedAt)}. Anki has no live link to this site, so import again whenever you want these numbers brought up to date.</p>
        ) : (
          <p className="hb-hint">This tells the PANCE map what you’ve already studied. Your cards stay in Anki. Only counts and the cards you keep forgetting are saved here.</p>
        )}
        {data && !data.hasHistory && (
          <p className="sd-warning" role="alert">This export has no review history, so every card looks brand new. Export again with “Include Scheduling Information” turned on.</p>
        )}
        {!data && (
          <ol className="sd-howto">
            <li>On the computer where you use Anki, choose <strong>File → Export</strong>.</li>
            <li>Set the format to <strong>Anki Deck Package</strong> and pick <strong>All Decks</strong>.</li>
            <li>Turn on <strong>Include Scheduling Information</strong> and <strong>Support older Anki versions</strong>. Turn off <strong>Include media</strong>.</li>
            <li>Choose the file below.</li>
          </ol>
        )}
        {notice && <p className="sd-outcome">{notice}</p>}
        {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
        {busy && (
          <div>
            <div className="progress-label"><span>{reading ? 'Reading your decks…' : 'Uploading…'}</span><span>{progress}%</span></div>
            <div className={`progress${reading ? ' is-indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? 0}><div style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        <input ref={input} className="sd-file" type="file" accept=".apkg,.colpkg" aria-label="Your Anki export" onChange={(e) => choose(e.target.files?.[0])} />
        <div className="sd-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{data ? 'Import a newer export' : 'Choose your Anki export'}</button>
          {data && <button type="button" className="hb-text-btn sd-danger-link" disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </section>

      {data && (
        <section className="sd-card">
          <h2>Match your decks to organ systems</h2>
          <p className="hb-hint">Decks with an obvious name are matched for you. A subdeck follows its parent unless you change it, or its own name says otherwise.</p>
          <ul className="sd-match-list">
            {data.decks.slice(0, 200).map((deck) => <DeckLine key={deck.name} deck={deck} saving={saving} onMatch={(name, value) => match('deck', name, value)} />)}
          </ul>
          {data.decks.length > 200 && <p className="hb-hint">Showing the first 200 of {data.decks.length} decks.</p>}
          {data.unmatched.cards > 0 && (
            <div className="sd-unmatched">
              <p className="sd-found"><strong>{data.unmatched.cards.toLocaleString()} cards</strong> don’t count toward anything yet.</p>
              {data.unmatched.tags.length > 0 && (
                <>
                  <p className="hb-hint">If a deck covers several systems, match by tag instead. These are the commonest tags on those cards.</p>
                  <ul className="sd-match-list">
                    {data.unmatched.tags.map(({ tag, cards }) => (
                      <li key={tag} className="sd-match">
                        <span className="sd-test-main"><strong>{tag}</strong><small>{cards.toLocaleString()} card{cards === 1 ? '' : 's'}</small></span>
                        <MatchSelect label={`Organ system for tag ${tag}`} value="" saving={saving} onChange={(value) => match('tag', tag, value)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {data && data.leeches.length > 0 && (
        <section className="sd-card">
          <h2>Cards you keep forgetting</h2>
          <p className="hb-hint">Cards you’ve forgotten 3 times or more, worst first{data.leechCount > data.leeches.length ? ` (the top ${data.leeches.length} of ${data.leechCount})` : ''}. Good ones to ask your AI to test you on.</p>
          <ul className="sd-leeches">
            {data.leeches.map((card, i) => (
              <li key={i}>
                <details>
                  <summary><span className="td-chip">{card.lapses}×</span><span>{card.front}</span></summary>
                  {card.back && <p>{card.back}</p>}
                  <small>{card.deck}</small>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
