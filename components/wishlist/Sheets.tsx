'use client';

import { useEffect, useMemo, useState } from 'react';
import GenerateReply from '@/components/ai/GenerateReply';
import { buildIdeasPrompt, IdeasReplyError, parseSuggestions, shoppingSearchUrl, type Suggestion } from '@/lib/wishlist/ai';
import { PRIORITIES, PRIORITY_LABELS, type ItemFields, type ItemView, type ListFields, type ListKind, type OwnerList } from '@/lib/wishlist/model';
import { Thumb } from './GiverList';
import './wishlist.css';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="wl-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wl-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="wl-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="wl-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- A list's details ------------------------------------------------------------

const EMOJIS = ['🎁', '🎄', '🎂', '🏠', '🛒', '💡', '🧸', '👗', '🎮', '📚', '🍳', '✈️'];

export function ListSheet({ list, kind, onSave, onDelete, onClose }: {
  list: OwnerList | null; kind: ListKind;
  onSave: (fields: ListFields) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [f, setF] = useState<Required<ListFields>>({
    name: list?.name ?? '', emoji: list?.emoji ?? (kind === 'for' ? '💡' : '🎁'), person: list?.person ?? '',
    occasion: list?.occasion ?? '', date: list?.date ?? '', note: list?.note ?? '', householdHidden: list?.householdHidden ?? false,
  });
  const set = (patch: Partial<ListFields>) => setF((old) => ({ ...old, ...patch }));
  const isFor = (list?.kind ?? kind) === 'for';
  return (
    <Sheet title={list ? 'List details' : isFor ? 'New gift ideas list' : 'New list'} onClose={onClose}>
      <form className="wl-form" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
        <label>Name<input value={f.name} maxLength={60} required autoFocus onChange={(e) => set({ name: e.target.value })} placeholder={isFor ? 'e.g. Things Sam mentioned' : 'e.g. Christmas, House, Needs'} /></label>
        {isFor && <label>Who it’s about<input value={f.person} maxLength={40} onChange={(e) => set({ person: e.target.value })} placeholder="Their name" /></label>}
        <div className="wl-emoji-row" role="group" aria-label="Emoji">
          {EMOJIS.map((e) => <button key={e} type="button" className={f.emoji === e ? 'is-on' : ''} onClick={() => set({ emoji: e })}>{e}</button>)}
        </div>
        <div className="wl-two">
          <label>Occasion (optional)<input value={f.occasion} maxLength={40} onChange={(e) => set({ occasion: e.target.value })} placeholder="Birthday, Christmas…" /></label>
          <label>Date (optional)<input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
        </div>
        <label>Note (optional)<textarea rows={2} value={f.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} placeholder={isFor ? 'Anything to remember' : 'Shown to people you share it with'} /></label>
        {!isFor && (
          <label className="wl-check">
            <input type="checkbox" checked={!f.householdHidden} onChange={(e) => set({ householdHidden: !e.target.checked })} />
            Show to my household (they see it under “Shared with me”, and can say what they’re getting)
          </label>
        )}
        {isFor && <p className="wl-hint">Gift ideas are private to you. They’re never shared, not even with {f.person || 'them'}.</p>}
        <div className="wl-row">
          <button type="submit" className="btn btn-primary" disabled={!f.name.trim()}>Save</button>
          {onDelete && <button type="button" className="btn btn-secondary wl-danger" onClick={onDelete}>Delete list</button>}
        </div>
      </form>
    </Sheet>
  );
}

// ---- An item ---------------------------------------------------------------------

export function ItemSheet({ item, lists, listId, me, canGotIt, importImage, onSave, onMove, onDelete, onClose }: {
  item: ItemView | null; lists: OwnerList[]; listId: string; me: string; canGotIt: boolean;
  importImage: (url: string) => Promise<string>;
  onSave: (fields: ItemFields) => void; onMove: (toListId: string) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [f, setF] = useState({
    url: item?.url ?? '', title: item?.title ?? '', description: item?.description ?? '', price: item?.price === null || item?.price === undefined ? '' : String(item.price),
    currency: item?.currency ?? 'USD', priority: item?.priority ?? 'love', quantity: item?.quantity ?? 1, note: item?.note ?? '', gotIt: item?.gotIt ?? false,
  });
  const [image, setImage] = useState<{ id: string; url: string | null }>({ id: '', url: item?.imageUrl ?? null });
  const [keepImage, setKeepImage] = useState(true);
  const [imageLink, setImageLink] = useState('');
  const [imageMsg, setImageMsg] = useState('');
  const set = (patch: Partial<typeof f>) => setF((old) => ({ ...old, ...patch }));

  const useImageLink = async () => {
    setImageMsg('Fetching…');
    try {
      const id = await importImage(imageLink);
      setImage({ id, url: `/api/wishlist/image/${me}/${id}` });
      setKeepImage(false);
      setImageLink('');
      setImageMsg('');
    } catch (e) {
      setImageMsg((e as Error).message);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fields: ItemFields = { ...f, price: f.price === '' ? null : Number(f.price) };
    // Only touch the picture if it was changed or removed here.
    if (!keepImage) fields.image = image.id;
    onSave(fields);
  };

  return (
    <Sheet title={item ? 'Edit item' : 'Add an item'} onClose={onClose}>
      <form className="wl-form" onSubmit={submit}>
        <label>Name<input value={f.title} maxLength={200} autoFocus={!item} onChange={(e) => set({ title: e.target.value })} placeholder="What is it?" /></label>
        <label>Link (optional)<input type="url" inputMode="url" value={f.url} maxLength={2000} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" /></label>
        <div className="wl-two">
          <label>Price<input type="number" inputMode="decimal" min="0" step="0.01" value={f.price} onChange={(e) => set({ price: e.target.value })} /></label>
          <label>Currency<input value={f.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
        </div>
        <div className="wl-two">
          <label>How much<select value={f.priority} onChange={(e) => set({ priority: e.target.value as typeof f.priority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select></label>
          <label>Quantity<input type="number" inputMode="numeric" min="1" max="99" value={f.quantity} onChange={(e) => set({ quantity: Number(e.target.value) || 1 })} /></label>
        </div>
        <label>Description<textarea rows={3} value={f.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} /></label>
        <label>My note (size, colour…)<input value={f.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} /></label>
        <div className="wl-image-edit">
          <Thumb url={image.url} title={f.title} />
          <div>
            <label>Picture link<input type="url" value={imageLink} onChange={(e) => setImageLink(e.target.value)} placeholder="Paste a link to a picture" /></label>
            <div className="wl-row">
              <button type="button" className="btn btn-secondary" disabled={!imageLink.trim()} onClick={useImageLink}>Use it</button>
              {image.url && <button type="button" className="btn btn-secondary" onClick={() => { setImage({ id: '', url: null }); setKeepImage(false); }}>Remove</button>}
            </div>
            {imageMsg && <p className="wl-hint">{imageMsg}</p>}
          </div>
        </div>
        {canGotIt && (
          <label className="wl-check"><input type="checkbox" checked={f.gotIt} onChange={(e) => set({ gotIt: e.target.checked })} /> I got this myself (hide it from anyone given the list)</label>
        )}
        {item && lists.length > 1 && (
          <label>Move to list
            <select value={listId} onChange={(e) => { if (e.target.value !== listId) onMove(e.target.value); }}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>)}
            </select>
          </label>
        )}
        <div className="wl-row">
          <button type="submit" className="btn btn-primary" disabled={!f.title.trim() && !f.url.trim()}>Save</button>
          {onDelete && <button type="button" className="btn btn-secondary wl-danger" onClick={onDelete}>Delete</button>}
        </div>
      </form>
    </Sheet>
  );
}

// ---- Sharing ---------------------------------------------------------------------

export function ShareSheet({ list, onAct, onClose }: { list: OwnerList; onAct: (op: 'create' | 'revoke' | 'regenerate') => Promise<boolean>; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const link = list.shareToken && typeof window !== 'undefined' ? `${window.location.origin}/wishlist/s/${list.shareToken}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied('Copied.'); } catch { setCopied('Select the link and copy it.'); }
  };
  return (
    <Sheet title={`Share “${list.name}”`} onClose={onClose}>
      <div className="wl-form">
        {link ? (
          <>
            <label>Link anyone can open
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div className="wl-row">
              <button type="button" className="btn btn-primary" onClick={copy}>Copy link</button>
              <button type="button" className="btn btn-secondary" onClick={() => { if (confirm('The old link stops working. People who have it will need the new one.')) void onAct('regenerate'); }}>New link</button>
              <button type="button" className="btn btn-secondary wl-danger" onClick={() => void onAct('revoke')}>Stop sharing</button>
            </div>
            {copied && <p className="wl-hint" role="status">{copied}</p>}
          </>
        ) : (
          <>
            <p>Make a link for this list. Anyone you send it to can see it without an account.</p>
            <button type="button" className="btn btn-primary" onClick={() => void onAct('create')}>Make a share link</button>
          </>
        )}
        <ul className="wl-hint-list">
          <li>People with the link can tick “I’m getting this” so nobody doubles up.</li>
          <li><strong>You never see who claimed what</strong>, so the gifts stay a surprise, on your page and on your own link.</li>
          <li>Items marked “I got this myself” are hidden from them.</li>
          <li>Whoever shares in your household can also see this list in the app.</li>
        </ul>
      </div>
    </Sheet>
  );
}

// ---- Ideas from an AI ---------------------------------------------------------------

export function IdeasSheet({ list, onAdd, onClose }: { list: OwnerList; onAdd: (s: Suggestion) => Promise<boolean>; onClose: () => void }) {
  const [hints, setHints] = useState({ forWho: list.kind === 'for' ? list.person : 'me', occasion: list.occasion, budget: '', interests: '' });
  const [reply, setReply] = useState('');
  const [ideas, setIdeas] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState('');
  const prompt = useMemo(() => buildIdeasPrompt(list.name, list.items, hints), [list.name, list.items, hints]);

  const read = (text: string) => {
    try {
      setIdeas(parseSuggestions(text));
      setError('');
    } catch (e) {
      setIdeas(null);
      setError(e instanceof IdeasReplyError ? e.message : 'Couldn’t read that.');
    }
  };
  const check = (text: string) => { try { parseSuggestions(text); return null; } catch (e) { return (e as Error).message; } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied('Copied. Paste it into your AI app.'); } catch { setCopied('Select the prompt and copy it.'); }
  };

  return (
    <Sheet title="Find more ideas" onClose={onClose}>
      <div className="wl-form">
        <div className="wl-two">
          <label>Who it’s for<input value={hints.forWho} maxLength={80} onChange={(e) => setHints({ ...hints, forWho: e.target.value })} /></label>
          <label>Occasion<input value={hints.occasion} maxLength={80} onChange={(e) => setHints({ ...hints, occasion: e.target.value })} placeholder="Birthday…" /></label>
        </div>
        <div className="wl-two">
          <label>Budget<input value={hints.budget} maxLength={80} onChange={(e) => setHints({ ...hints, budget: e.target.value })} placeholder="Under $50" /></label>
          <label>Interests<input value={hints.interests} maxLength={400} onChange={(e) => setHints({ ...hints, interests: e.target.value })} placeholder="Hiking, coffee…" /></label>
        </div>
        <details className="wl-details"><summary>See the prompt</summary><textarea readOnly rows={8} value={prompt} onFocus={(e) => e.currentTarget.select()} /></details>
        <div className="wl-row">
          <button type="button" className="btn btn-primary" onClick={copy}>1. Copy prompt</button>
          {copied && <span className="wl-hint" role="status">{copied}</span>}
        </div>
        <GenerateReply task="wishlist" prompt={prompt} onReply={(text) => { setReply(text); read(text); }} check={check} />
        <label>2. Paste the reply here
          <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste what your AI wrote" />
        </label>
        <div className="wl-row">
          <button type="button" className="btn btn-secondary" disabled={!reply.trim()} onClick={() => read(reply)}>Read the ideas</button>
        </div>
        {error && <p className="wl-error" role="alert">{error}</p>}
        {ideas && (
          <ul className="wl-ideas">
            {ideas.map((s) => (
              <li key={s.title} className="wl-idea">
                <h3>{s.title}</h3>
                {s.why && <p>{s.why}</p>}
                <p className="wl-item-meta">{s.priceRange && <strong>{s.priceRange}</strong>}</p>
                <div className="wl-row">
                  <button type="button" className="btn btn-primary" disabled={added.has(s.title)} onClick={async () => { if (await onAdd(s)) setAdded(new Set(added).add(s.title)); }}>
                    {added.has(s.title) ? 'Added' : 'Add to list'}
                  </button>
                  <a className="btn btn-secondary" href={s.url || shoppingSearchUrl(s.searchQuery)} target="_blank" rel="noopener noreferrer">{s.url ? 'Open link' : 'Search shops'}</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
