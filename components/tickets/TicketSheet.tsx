'use client';

import { useEffect, useRef, useState } from 'react';
import { recentErrors } from './error-buffer';

// The ticket sheet: file a bug / idea / question, see what was sent along with it,
// and check the status of tickets you've filed before.

const KINDS = [
  { id: 'bug', label: '🐞 Bug' },
  { id: 'idea', label: '💡 Idea' },
  { id: 'question', label: '❓ Question' },
  { id: 'other', label: '📝 Other' },
] as const;
const SEVERITIES = [
  { id: 'minor', label: 'Minor' },
  { id: 'annoying', label: 'Annoying' },
  { id: 'blocking', label: "Can't use it" },
] as const;
const STATUS_LABEL: Record<string, string> = { open: 'Received', in_progress: 'Being worked on', done: 'Done', wontfix: 'Not planned' };
const MAX_MESSAGE = 4000;
const MAX_IMAGE = 10 * 1024 * 1024;

type Mine = {
  id: string; kind: string; severity?: string; message: string; status: string; createdAt: string;
  hasImage: boolean; page: string; reply?: { text: string; at: string }; comments?: { text: string; at: string }[];
};

/** What the browser can tell us about itself and the page. The server adds who and which build. */
function collectContext() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    path: location.pathname + location.search,
    title: document.title,
    clientTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    pixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
    userAgent: navigator.userAgent,
    theme: document.documentElement.getAttribute('data-theme') || '',
    online: navigator.onLine,
    standalone: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    referrer: document.referrer,
    errors: recentErrors(),
  };
}

type Ctx = ReturnType<typeof collectContext>;

function detailRows(c: Ctx): [string, string][] {
  return [
    ['Page', c.path],
    ['Page title', c.title],
    ['Time', `${new Date(c.clientTime).toLocaleString()} (${c.timezone})`],
    ['Window', `${c.viewport} on a ${c.screen} screen, ${c.pixelRatio}x`],
    ['Device', c.userAgent],
    ['Theme', c.theme || 'default'],
    ['Online', c.online ? 'yes' : 'no'],
    ['Installed app', c.standalone ? 'yes' : 'no'],
    ['Came from', c.referrer || 'nowhere (opened directly)'],
    ['Recent errors', c.errors.length ? c.errors.join('\n') : 'none'],
    ['Also sent', 'your account name and the site version'],
  ];
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function TicketSheet({ onClose }: { onClose: () => void }) {
  const [ctx] = useState(collectContext);
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [kind, setKind] = useState<string>('bug');
  const [severity, setSeverity] = useState('');
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [mineError, setMineError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState<{ id: string; text: string; busy: boolean; error: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // On iPhone the keyboard shrinks the visual viewport but not the layout one, so size the sheet to
  // what is actually visible and keep the focused field (and Send) in view.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = backdropRef.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
      const active = document.activeElement;
      if (active instanceof HTMLElement && el.contains(active) && /^(TEXTAREA|INPUT)$/.test(active.tagName)) active.scrollIntoView({ block: 'nearest' });
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
  }, []);

  async function sendFollowUp() {
    if (!followUp || followUp.busy || !followUp.text.trim()) return;
    setFollowUp({ ...followUp, busy: true, error: '' });
    try {
      const res = await fetch(`/api/tickets/${followUp.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: followUp.text }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not send that');
      setMine((list) => list?.map((t) => (t.id === followUp.id ? body.ticket : t)) ?? list);
      setFollowUp(null);
    } catch (err) {
      setFollowUp((f) => f && { ...f, busy: false, error: err instanceof Error ? err.message : 'Could not send that' });
    }
  }

  async function loadMine() {
    setMineError('');
    try {
      const res = await fetch('/api/tickets', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load your tickets');
      setMine(body.tickets);
    } catch (e) {
      setMineError(e instanceof Error ? e.message : 'Could not load your tickets');
    }
  }
  useEffect(() => { if (tab === 'mine') void loadMine(); }, [tab]);

  function pickImage(file: File | undefined) {
    setError('');
    if (!file) return setImage(null);
    if (!file.type.startsWith('image/')) { setError('That file is not an image'); return; }
    if (file.size > MAX_IMAGE) { setError('That image is too large (10 MB max)'); return; }
    setImage(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!message.trim()) { setError('Write a few words about it first'); return; }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      // Re-read the errors now: more may have happened while the sheet was open.
      form.set('data', JSON.stringify({ kind, severity: kind === 'bug' ? severity : '', message, context: { ...ctx, errors: recentErrors() } }));
      if (image) form.set('image', image);
      const res = await fetch('/api/tickets', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not send that');
      setSent(true);
      setMessage(''); setImage(null); setSeverity('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={backdropRef} className="tk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tk-sheet" role="dialog" aria-modal="true" aria-label="Feedback">
        <div className="tk-head">
          <div className="tk-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'is-on' : ''} onClick={() => { setTab('new'); setSent(false); }}>Send feedback</button>
            <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'is-on' : ''} onClick={() => setTab('mine')}>My tickets</button>
          </div>
          <button type="button" className="tk-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {tab === 'new' && sent && (
          <div className="tk-body">
            <p className="tk-ok">✅ Sent. Thanks! You can follow it under My tickets.</p>
            <div className="tk-row">
              <button type="button" className="tk-btn" onClick={() => setSent(false)}>Send another</button>
              <button type="button" className="tk-btn tk-btn-quiet" onClick={() => setTab('mine')}>My tickets</button>
            </div>
          </div>
        )}

        {tab === 'new' && !sent && (
          <form className="tk-form" onSubmit={submit}>
            <div className="tk-body">
            <div className="tk-kinds" role="radiogroup" aria-label="Kind">
              {KINDS.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={kind === k.id ? 'is-on' : ''} onClick={() => setKind(k.id)}>{k.label}</button>
              ))}
            </div>
            <textarea
              className="tk-text" value={message} maxLength={MAX_MESSAGE} rows={5} autoFocus
              placeholder={kind === 'bug' ? 'What went wrong? What did you expect?' : kind === 'idea' ? "What would you like it to do?" : 'Tell me about it'}
              onChange={(e) => setMessage(e.target.value)}
            />
            {kind === 'bug' && (
              <div className="tk-kinds" role="radiogroup" aria-label="How bad">
                {SEVERITIES.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={severity === s.id} className={severity === s.id ? 'is-on' : ''} onClick={() => setSeverity(severity === s.id ? '' : s.id)}>{s.label}</button>
                ))}
              </div>
            )}
            <div className="tk-row">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
              <button type="button" className="tk-btn tk-btn-quiet" onClick={() => fileRef.current?.click()}>📎 {image ? 'Change image' : 'Add a screenshot or photo'}</button>
              {image && (
                <span className="tk-file">{image.name.slice(0, 30)}
                  <button type="button" aria-label="Remove image" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ''; }}>✕</button>
                </span>
              )}
            </div>

            <p className="tk-included">
              Included: this page, your device, the time, and recent errors.{' '}
              <button type="button" className="tk-link" aria-expanded={details} onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>
            </p>
            {details && (
              <dl className="tk-details">
                {detailRows(ctx).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
              </dl>
            )}

            {error && <p className="tk-error" role="alert">{error}</p>}
            </div>
            {/* Outside the scrolling part, so Send never slides off screen. */}
            <div className="tk-foot">
              <button type="submit" className="tk-btn tk-btn-primary" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        )}

        {tab === 'mine' && (
          <div className="tk-body">
            {mineError && <p className="tk-error" role="alert">{mineError}</p>}
            {!mine && !mineError && <p className="tk-muted">Loading…</p>}
            {mine && mine.length === 0 && <p className="tk-muted">Nothing sent yet.</p>}
            {mine?.map((t) => (
              <article key={t.id} className="tk-ticket">
                <div className="tk-ticket-top">
                  <span className={`tk-status is-${t.status}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                  <span className="tk-muted">{KINDS.find((k) => k.id === t.kind)?.label ?? t.kind} · {when(t.createdAt)}</span>
                </div>
                <p className="tk-msg">{t.message}</p>
                {t.hasImage && <p className="tk-muted">📎 Image attached</p>}
                {t.reply && <div className="tk-reply"><strong>Reply</strong><p>{t.reply.text}</p></div>}
                {(t.comments ?? []).map((cm, i) => (
                  <div key={i} className="tk-reply is-you"><strong>You added · {when(cm.at)}</strong><p>{cm.text}</p></div>
                ))}
                {(t.status === 'open' || t.status === 'in_progress') && (followUp?.id === t.id ? (
                  <div className="tk-follow">
                    <textarea className="tk-text" rows={3} maxLength={MAX_MESSAGE} autoFocus value={followUp.text} placeholder="Anything to add?" onChange={(e) => setFollowUp({ ...followUp, text: e.target.value })} />
                    {followUp.error && <p className="tk-error" role="alert">{followUp.error}</p>}
                    <div className="tk-row">
                      <button type="button" className="tk-btn tk-btn-primary" disabled={followUp.busy || !followUp.text.trim()} onClick={() => void sendFollowUp()}>{followUp.busy ? 'Sending…' : 'Add'}</button>
                      <button type="button" className="tk-btn tk-btn-quiet" onClick={() => setFollowUp(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div><button type="button" className="tk-btn tk-btn-quiet" onClick={() => setFollowUp({ id: t.id, text: '', busy: false, error: '' })}>Add a follow-up</button></div>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
