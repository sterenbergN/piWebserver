'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './TicketsPanel.css';

// Admin: choose who can file tickets, then review what came in. Opening a ticket marks it
// seen (clears its dot). Replies are shown to the person who filed it; notes stay here.

type Ctx = {
  path: string; title?: string; clientTime?: string; timezone?: string; viewport?: string; screen?: string; pixelRatio?: number;
  userAgent?: string; theme?: string; online?: boolean; standalone?: boolean; referrer?: string; errors: string[]; build?: string;
};
type Ticket = {
  id: string; userId: string; username: string; kind: string; severity?: string; message: string; status: string;
  createdAt: string; updatedAt: string; image?: string; context: Ctx; reply?: { text: string; at: string }; note?: string; seenAt?: string;
};
type Account = { id: string; username: string };
type Filter = 'open' | 'in_progress' | 'done' | 'wontfix' | 'all';

const STATUSES: { id: Exclude<Filter, 'all'>; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In progress' }, { id: 'done', label: 'Done' }, { id: 'wontfix', label: "Won't fix" },
];
const KIND_ICON: Record<string, string> = { bug: '🐞', idea: '💡', question: '❓', other: '📝' };
const SEVERITY_LABEL: Record<string, string> = { minor: 'Minor', annoying: 'Annoying', blocking: "Can't use it" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function TicketsPanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tickets', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load tickets');
      const body = await res.json();
      setTickets(body.tickets); setAccounts(body.accounts); setEnabled(body.enabledUserIds);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load tickets' });
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggleAccount(id: string, on: boolean) {
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((x) => x !== id);
    const before = enabled;
    setEnabled(next);
    const res = await fetch('/api/admin/tickets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabledUserIds: next }) });
    if (!res.ok) { setEnabled(before); setNotice({ kind: 'error', text: 'Could not save that' }); }
  }

  function replace(t: Ticket) {
    setTickets((list) => list.map((x) => (x.id === t.id ? t : x)));
  }

  async function open(t: Ticket) {
    setOpenId(t.id);
    if (!t.seenAt) {
      const res = await fetch(`/api/admin/tickets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: true }) });
      if (res.ok) replace((await res.json()).ticket);
    }
  }

  async function save(t: Ticket, patch: Record<string, unknown>, done?: string) {
    const res = await fetch(`/api/admin/tickets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: 'error', text: body.error || 'Could not save that' }); return; }
    replace(body.ticket);
    if (done) setNotice({ kind: 'success', text: done });
  }

  async function remove(t: Ticket) {
    if (!window.confirm('Delete this ticket and its image? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/tickets/${t.id}`, { method: 'DELETE' });
    if (!res.ok) { setNotice({ kind: 'error', text: 'Could not delete that' }); return; }
    setTickets((list) => list.filter((x) => x.id !== t.id));
    setOpenId(null);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length };
    for (const t of tickets) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tickets]);
  const newCount = tickets.filter((t) => !t.seenAt).length;
  const shown = tickets.filter((t) => filter === 'all' || t.status === filter);
  const current = tickets.find((t) => t.id === openId) ?? null;

  return (
    <div className="tkp">
      {notice && <div className={`adm-notice is-${notice.kind}`} role="status">{notice.text}</div>}

      <section className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2>Who can send tickets</h2>
            <p>Accounts ticked here get a small Feedback button at the bottom of every page. You always have it.</p>
          </div>
        </div>
        <div className="tkp-accounts">
          {accounts.length === 0 && loaded && <p className="adm-muted">No accounts yet.</p>}
          {accounts.map((a) => (
            <label key={a.id} className="adm-check">
              <input type="checkbox" checked={enabled.includes(a.id)} onChange={(e) => void toggleAccount(a.id, e.target.checked)} /> {a.username}
            </label>
          ))}
        </div>
      </section>

      {current ? (
        <Detail key={current.id} t={current} onBack={() => setOpenId(null)} onSave={save} onDelete={remove} />
      ) : (
        <section className="adm-card">
          <div className="adm-card-head">
            <div>
              <h2>Tickets {newCount > 0 && <span className="adm-badge is-new">{newCount} new</span>}</h2>
              <p>Newest first. A dot means you haven&apos;t opened it yet.</p>
            </div>
            <button type="button" className="adm-small-btn" onClick={() => void load()}>Refresh</button>
          </div>
          <div className="tkp-filters" role="tablist">
            {([...STATUSES, { id: 'all', label: 'All' }] as { id: Filter; label: string }[]).map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'is-on' : ''} onClick={() => setFilter(f.id)}>
                {f.label} {counts[f.id] ? <span>{counts[f.id]}</span> : null}
              </button>
            ))}
          </div>
          <div className="adm-list">
            {loaded && shown.length === 0 && <p className="adm-muted">Nothing here.</p>}
            {shown.map((t) => (
              <button key={t.id} type="button" className="adm-row tkp-item" onClick={() => void open(t)}>
                <span className={`tkp-dot${t.seenAt ? '' : ' is-new'}`} aria-label={t.seenAt ? undefined : 'New'} />
                <span className="adm-row-main">
                  <strong>{KIND_ICON[t.kind] ?? '📝'} {t.message.slice(0, 90)}{t.message.length > 90 ? '…' : ''}</strong>
                  <span className="adm-row-sub">{t.username} · {t.context.path} · {when(t.createdAt)}</span>
                </span>
                <span className={`tkp-status is-${t.status}`}>{STATUSES.find((s) => s.id === t.status)?.label ?? t.status}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Detail({ t, onBack, onSave, onDelete }: {
  t: Ticket; onBack: () => void;
  onSave: (t: Ticket, patch: Record<string, unknown>, done?: string) => Promise<void>;
  onDelete: (t: Ticket) => Promise<void>;
}) {
  const [reply, setReply] = useState(t.reply?.text ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const c = t.context;
  const rows: [string, string | undefined][] = [
    ['Account', `${t.username} (${t.userId})`],
    ['Filed', `${new Date(t.createdAt).toLocaleString()}${c.timezone ? ` (their time zone: ${c.timezone})` : ''}`],
    ['Their clock', c.clientTime ? new Date(c.clientTime).toLocaleString() : undefined],
    ['Page title', c.title],
    ['Window', c.viewport ? `${c.viewport}${c.screen ? ` on a ${c.screen} screen` : ''}${c.pixelRatio ? `, ${c.pixelRatio}x` : ''}` : undefined],
    ['Theme', c.theme],
    ['Online', c.online === undefined ? undefined : c.online ? 'yes' : 'no'],
    ['Installed app', c.standalone === undefined ? undefined : c.standalone ? 'yes' : 'no'],
    ['Came from', c.referrer],
    ['Site version', c.build],
    ['Device', c.userAgent],
  ];

  return (
    <section className="adm-card tkp-detail">
      <button type="button" className="adm-back-link" onClick={onBack}>← All tickets</button>
      <div className="tkp-meta">
        <span className="adm-badge">{KIND_ICON[t.kind]} {t.kind}</span>
        {t.severity && <span className="adm-badge is-warn">{SEVERITY_LABEL[t.severity] ?? t.severity}</span>}
        <span className="adm-muted">{t.username} · {when(t.createdAt)}</span>
      </div>
      <p className="tkp-message">{t.message}</p>

      {t.image && (
        <a href={`/api/tickets/files/${t.image}`} target="_blank" rel="noreferrer"><img className="tkp-image" src={`/api/tickets/files/${t.image}`} alt="Attached by the sender" /></a>
      )}

      <p>
        <a className="adm-link-btn" href={c.path} target="_blank" rel="noreferrer">Open {c.path} ↗</a>
      </p>

      <div className="tkp-status-row" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s.id} type="button" className={`tkp-chip${t.status === s.id ? ' is-on' : ''}`} onClick={() => void onSave(t, { status: s.id })}>{s.label}</button>
        ))}
      </div>

      <label className="adm-field">Reply (they will see this)
        <textarea className="tkp-text" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
      </label>
      <div><button type="button" className="adm-small-btn" disabled={reply.trim() === (t.reply?.text ?? '')} onClick={() => void onSave(t, { reply }, 'Reply saved')}>Save reply</button></div>

      <label className="adm-field">Private note (only you)
        <textarea className="tkp-text" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div><button type="button" className="adm-small-btn" disabled={note.trim() === (t.note ?? '')} onClick={() => void onSave(t, { note }, 'Note saved')}>Save note</button></div>

      <h3 className="adm-h3">What was captured</h3>
      <dl className="tkp-dl">
        {rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        <div><dt>Recent errors</dt><dd>{c.errors.length ? c.errors.join('\n') : 'none'}</dd></div>
      </dl>

      <div className="tkp-danger"><button type="button" className="adm-small-btn" onClick={() => void onDelete(t)}>Delete ticket</button></div>
    </section>
  );
}
