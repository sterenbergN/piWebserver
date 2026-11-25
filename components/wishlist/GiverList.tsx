'use client';

import { useState } from 'react';
import { arrangeGroups, formatPrice, PRIORITY_LABELS, type GiverItem, type GiverList as GiverListData } from '@/lib/wishlist/model';
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
  const row = (item: GiverItem, onTop = false) => (
    <GiverRow key={item.id} item={item} emoji={list.emoji} onTop={onTop} askName={askName} readOnly={readOnly} onClaim={onClaim} onUnclaim={onUnclaim} />
  );
  return (
    <ul className="wl-items">
      {arrangeGroups(list.items, list.groups ?? []).map((r) => r.kind === 'item' ? row(r.item) : (
        <li key={r.id} className="wl-group">
          <div className="wl-group-head">
            <div>
              <h3><span aria-hidden>🔀</span> {r.name}</h3>
              <p className="wl-hint">Any one of these would do. Best pick right now is first{r.reason ? `: ${r.reason}` : ''}.</p>
            </div>
          </div>
          <ul className="wl-items">{r.items.map((item) => row(item, item.id === r.pick))}</ul>
        </li>
      ))}
    </ul>
  );
}

function GiverRow({ item, emoji, onTop, askName, readOnly, onClaim, onUnclaim }: {
  item: GiverItem; emoji: string; onTop: boolean; askName: boolean; readOnly?: boolean;
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
  // Someone is getting another of its group, which covers this one.
  const soldOut = !item.mine && (left < 1 || item.groupTaken);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); setOpen(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <li className={`wl-item${soldOut ? ' is-taken' : ''}${onTop ? ' is-top' : ''}`}>
      <Thumb url={item.imageUrl} title={item.title} emoji={emoji} store={item.store} />
      <div className="wl-item-body">
        <div className="wl-item-top">
          <h3 className="wl-item-title">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">{item.title}</a> : item.title}</h3>
          {onTop ? <span className="wl-pri wl-top">Best pick</span> : <span className={`wl-pri wl-pri-${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>}
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
              <p className="wl-claim-taken">{item.groupTaken ? 'Someone is already getting one of these.' : `Someone is already getting ${item.quantity > 1 ? 'all of these' : 'this'}.`}</p>
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

/** A steady tint per item (from its name), so a grid of pictureless items isn't one flat colour. */
function tintOf(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return (h % 8) + 1;
}

/**
 * An item's picture, or a soft tinted tile when it has none: the list's emoji when we know it,
 * else the shop's (or the item's) first letter.
 */
export function Thumb({ url, title, emoji, store }: { url: string | null; title: string; emoji?: string; store?: string }) {
  // The picture is kept on this site, so it's a plain <img>, not a remote one.
  if (url) return <img className="wl-thumb" src={url} alt="" loading="lazy" />;
  const initial = Array.from((store || title).trim())[0]?.toUpperCase() ?? '';
  return (
    <div className={`wl-thumb wl-thumb-empty wl-tint-${tintOf(title || store || '')}`} aria-hidden>
      {emoji ? <span className="wl-thumb-emoji">{emoji}</span> : <span className="wl-thumb-initial">{initial || '🎁'}</span>}
    </div>
  );
}
