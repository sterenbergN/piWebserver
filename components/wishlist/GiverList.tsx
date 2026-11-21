'use client';

import { useState } from 'react';
import { formatPrice, PRIORITY_LABELS, type GiverItem, type GiverList as GiverListData } from '@/lib/wishlist/model';
import './wishlist.css';

export type ClaimInput = { qty: number; name: string; note: string };

/** A list as a giver sees it: look, and say "I'm getting this". Used by the public share page and the in-app "Shared with me". */
export default function GiverList({ list, askName, onClaim, onUnclaim, readOnly }: {
  list: GiverListData;
  /** Share-link visitors can leave a name; household members are already known by theirs. */
  askName: boolean;
  onClaim: (itemId: string, input: ClaimInput) => Promise<void>;
  onUnclaim: (itemId: string) => Promise<void>;
  /** The owner looking at their own link: no claiming. */
  readOnly?: boolean;
}) {
  if (!list.items.length) return <p className="wl-empty">Nothing on this list yet.</p>;
  return (
    <ul className="wl-items">
      {list.items.map((item) => (
        <GiverRow key={item.id} item={item} askName={askName} readOnly={readOnly} onClaim={onClaim} onUnclaim={onUnclaim} />
      ))}
    </ul>
  );
}

function GiverRow({ item, askName, readOnly, onClaim, onUnclaim }: {
  item: GiverItem; askName: boolean; readOnly?: boolean;
  onClaim: (itemId: string, input: ClaimInput) => Promise<void>;
  onUnclaim: (itemId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const othersTaken = item.claimed - (item.mine?.qty ?? 0);
  const left = Math.max(0, item.quantity - othersTaken);
  const [qty, setQty] = useState(item.mine?.qty ?? 1);
  const [name, setName] = useState(item.mine?.name ?? '');
  const [note, setNote] = useState(item.mine?.note ?? '');
  const soldOut = !item.mine && left < 1;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); setOpen(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <li className={`wl-item${soldOut ? ' is-taken' : ''}`}>
      <Thumb url={item.imageUrl} title={item.title} />
      <div className="wl-item-body">
        <div className="wl-item-top">
          <h3 className="wl-item-title">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">{item.title}</a> : item.title}</h3>
          <span className={`wl-pri wl-pri-${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>
        </div>
        <p className="wl-item-meta">
          {item.price !== null && <strong>{formatPrice(item.price, item.currency)}</strong>}
          {item.quantity > 1 && <span>wants {item.quantity}</span>}
          {item.store && <span>{item.store}</span>}
        </p>
        {item.description && <p className="wl-item-desc">{item.description}</p>}
        {item.note && <p className="wl-item-note">📝 {item.note}</p>}

        {!readOnly && (
          <div className="wl-claim">
            {item.mine ? (
              <p className="wl-claim-mine">
                ✅ You’re getting {item.mine.qty > 1 ? `${item.mine.qty} of these` : 'this'}.{' '}
                <button type="button" className="wl-link" onClick={() => setOpen((o) => !o)}>Change</button>{' · '}
                <button type="button" className="wl-link" disabled={busy} onClick={() => run(() => onUnclaim(item.id))}>Undo</button>
              </p>
            ) : soldOut ? (
              <p className="wl-claim-taken">Someone is already getting {item.quantity > 1 ? 'all of these' : 'this'}.</p>
            ) : (
              <>
                {othersTaken > 0 && <p className="wl-claim-taken">{othersTaken} of {item.quantity} already taken.</p>}
                {!open && <button type="button" className="btn btn-secondary wl-claim-btn" onClick={() => setOpen(true)}>🎁 I’m getting this</button>}
              </>
            )}
            {open && (
              <form className="wl-claim-form" onSubmit={(e) => { e.preventDefault(); void run(() => onClaim(item.id, { qty, name, note })); }}>
                {left > 1 && (
                  <label>How many
                    <select value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                      {Array.from({ length: left }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                  </label>
                )}
                {askName && <label>Your name (optional)<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="So others can tell it’s you" /></label>}
                <label>Note (optional)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Colour, where from…" /></label>
                <div className="wl-row">
                  <button type="submit" className="btn btn-primary" disabled={busy}>{item.mine ? 'Save' : 'I’m getting this'}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                </div>
              </form>
            )}
            {error && <p className="wl-error" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export function Thumb({ url, title }: { url: string | null; title: string }) {
  // The picture is kept on this site, so it's a plain <img>, not a remote one.
  return url
    ? <img className="wl-thumb" src={url} alt="" loading="lazy" />
    : <div className="wl-thumb wl-thumb-empty" aria-hidden>{title.trim().charAt(0).toUpperCase() || '🎁'}</div>;
}
