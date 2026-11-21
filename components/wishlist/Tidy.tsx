'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatPrice, type OwnerList, type ReceivedGroup, type ReceivedItem } from '@/lib/wishlist/model';
import type { TidyDecision, TidyRow } from '@/lib/wishlist/tidy';
import { Thumb } from './GiverList';
import { Sheet } from './Sheets';
import './wishlist.css';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Something went wrong.');
  return json as T;
}

const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const givers = (g: { name: string; qty: number }[]) => (g.length ? g.map((x) => x.name || 'Someone').join(', ') : 'Someone');

type Row = Omit<TidyRow, 'image'> & { imageUrl: string | null };

/** Reveals who claimed what, only after the owner says the big day has been. */
export function TidySheet({ lists, onClose, onDone }: { lists: OwnerList[]; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'intro' | 'review' | 'done'>('intro');
  const [listId, setListId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [asOf, setAsOf] = useState('');
  const [last, setLast] = useState('');
  const [decisions, setDecisions] = useState<Record<string, TidyDecision>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({ got: 0, kept: 0 });
  const mine = lists.filter((l) => l.kind === 'mine');

  const show = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ asOf: string; lastTidyAt: string; rows: Row[] }>('/api/wishlist/tidy', { op: 'preview', listId: listId || null });
      setRows(r.rows);
      setAsOf(r.asOf);
      setLast(r.lastTidyAt);
      setDecisions(Object.fromEntries(r.rows.map((x) => [x.itemId, 'got' as TidyDecision])));
      const first = mine.find((l) => r.rows.some((x) => x.listId === l.id));
      setName(`${(listId ? mine.find((l) => l.id === listId) : first)?.occasion || 'Received'} ${new Date().getFullYear()}`.trim());
      setStep('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ got: number; kept: number }>('/api/wishlist/tidy', { op: 'apply', listId: listId || null, asOf, decisions, groupName: name });
      setSummary(r);
      setStep('done');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="🎉 After the occasion" onClose={onClose}>
      <div className="wl-form">
        {step === 'intro' && (
          <>
            <p>Once the birthday or Christmas has been, you can see what people got you, take those things off your lists and keep them in a Received history.</p>
            <p className="wl-banner">This shows who is getting what, which spoils the surprise. Only do it after the day.</p>
            {mine.length > 1 && (
              <label>Which lists
                <select value={listId} onChange={(e) => setListId(e.target.value)}>
                  <option value="">All my lists</option>
                  {mine.map((l) => <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>)}
                </select>
              </label>
            )}
            {error && <p className="wl-error" role="alert">{error}</p>}
            <div className="wl-row">
              <button type="button" className="btn btn-primary" disabled={busy || mine.length === 0} onClick={() => void show()}>{busy ? 'Looking…' : 'Yes, the day’s been. Show me'}</button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Not yet</button>
            </div>
          </>
        )}

        {step === 'review' && (rows.length === 0 ? (
          <>
            <p className="wl-empty">{last ? `Nobody has claimed anything since ${day(last)}.` : 'Nobody has marked anything as getting it for you yet.'}</p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <p className="wl-hint">Pick what actually turned up. “Got it” moves it to Received; the rest stay on your list and can be claimed again.{last ? ` Showing claims since ${day(last)}.` : ''}</p>
            <ul className="wl-tidy-rows">
              {rows.map((r) => (
                <li key={r.itemId} className="wl-tidy-row">
                  <Thumb url={r.imageUrl} title={r.title} />
                  <div className="wl-item-body">
                    <h3 className="wl-item-title">{r.title}{r.claimedQty > 1 ? ` x${r.claimedQty}` : ''}</h3>
                    <p className="wl-item-meta">
                      <span>{r.listEmoji} {r.listName}</span>
                      <span>From {givers(r.givers)}</span>
                      <span>{day(r.latestAt)}</span>
                    </p>
                    {r.claimedQty < r.quantity && <p className="wl-hint">You wanted {r.quantity}, so the other {r.quantity - r.claimedQty} stay on your list.</p>}
                    <div className="wl-seg" role="radiogroup" aria-label={`${r.title}: did you get it?`}>
                      {(['got', 'keep'] as const).map((d) => (
                        <button key={d} type="button" role="radio" aria-checked={decisions[r.itemId] === d} className={decisions[r.itemId] === d ? 'is-on' : ''}
                          onClick={() => setDecisions((old) => ({ ...old, [r.itemId]: d }))}>
                          {d === 'got' ? 'Got it' : 'Didn’t get it, keep'}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <label>Name this batch (for your Received history)<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas 2026" /></label>
            {error && <p className="wl-error" role="alert">{error}</p>}
            <div className="wl-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Tidying…' : 'Tidy up my lists'}</button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ))}

        {step === 'done' && (
          <>
            <p>{summary.got ? `Moved ${summary.got} thing${summary.got === 1 ? '' : 's'} to Received.` : 'Nothing moved.'}{summary.kept ? ` ${summary.kept} stay${summary.kept === 1 ? 's' : ''} on your list, free to claim again.` : ''}</p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

type View = Omit<ReceivedGroup, 'items'> & { items: (Omit<ReceivedItem, 'image'> & { imageUrl: string | null })[] };

/** What the owner has been given, by occasion, with a thank-you tick for each. */
export function ReceivedSheet({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<View[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/wishlist/received', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (j?.success) setGroups(j.groups); else setError(j?.message || 'Couldn’t load your history.');
    }).catch(() => { if (live) setError('Couldn’t load your history.'); });
    return () => { live = false; };
  }, []);

  const act = useCallback(async (action: unknown) => {
    try { setGroups((await post<{ groups: View[] }>('/api/wishlist/received', { action })).groups); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);

  return (
    <Sheet title="📦 Received" onClose={onClose}>
      <div className="wl-form">
        {error && <p className="wl-error" role="alert">{error}</p>}
        {groups === null && !error && <p className="wl-empty">Loading…</p>}
        {groups?.length === 0 && <p className="wl-empty">Nothing yet. After a birthday or Christmas, use “After the occasion” to move what you got here.</p>}
        {groups?.map((g) => (
          <section key={g.id} className="wl-recv-group">
            <div className="wl-recv-head">
              <h3>{g.name}</h3>
              <span className="wl-hint">{day(g.at)}</span>
              <button type="button" className="wl-link" onClick={() => { const n = prompt('Name this batch', g.name); if (n && n.trim()) void act({ type: 'renameGroup', groupId: g.id, name: n }); }}>Rename</button>
              <button type="button" className="wl-link wl-danger" onClick={() => { if (confirm(`Delete “${g.name}” from your history?`)) void act({ type: 'removeGroup', groupId: g.id }); }}>Delete</button>
            </div>
            <ul className="wl-tidy-rows">
              {g.items.map((it) => (
                <li key={it.id} className="wl-tidy-row">
                  <Thumb url={it.imageUrl} title={it.title} />
                  <div className="wl-item-body">
                    <h4 className="wl-item-title">{it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer nofollow">{it.title}</a> : it.title}{it.quantity > 1 ? ` x${it.quantity}` : ''}</h4>
                    <p className="wl-item-meta">
                      {it.price !== null && <strong>{formatPrice(it.price, it.currency)}</strong>}
                      <span>From {givers(it.givers)}</span>
                      {it.listName && <span>{it.listName}</span>}
                    </p>
                    <div className="wl-row">
                      <label className="wl-check-inline"><input type="checkbox" checked={it.thanked} onChange={(e) => void act({ type: 'thank', groupId: g.id, itemId: it.id, thanked: e.target.checked })} /> Thank-you sent</label>
                      <button type="button" className="wl-link wl-danger" onClick={() => { if (confirm(`Remove “${it.title}” from your history?`)) void act({ type: 'removeItem', groupId: g.id, itemId: it.id }); }}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
