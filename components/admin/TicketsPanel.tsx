'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPrompt, displayName, parseReport, type ParsedReport } from '@/lib/tickets/prompt';
import type { Ticket } from '@/lib/tickets/tickets';
import './TicketsPanel.css';

// Admin: review what came in, copy it for Claude Code, paste Claude's JSON report back, and
// choose who can file tickets. Opening a card marks it seen (clears its dot). Replies are
// shown to the person who filed it; notes stay here.

type Account = { id: string; username: string };
type Filter = 'open' | 'in_progress' | 'done' | 'wontfix' | 'all';
type Scope = 'active' | 'all' | 'selected';

const STATUSES: { id: Exclude<Filter, 'all'>; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In progress' }, { id: 'done', label: 'Done' }, { id: 'wontfix', label: 'Won’t fix' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<string, string>;
const KIND_ICON: Record<string, string> = { bug: '🐞', idea: '💡', question: '❓', other: '📝' };
const KIND_FILTERS = [{ id: 'all', label: 'All kinds' }, { id: 'bug', label: '🐞 Bugs' }, { id: 'idea', label: '💡 Ideas' }, { id: 'question', label: '❓ Questions' }, { id: 'other', label: '📝 Other' }];
const SEVERITY_LABEL: Record<string, string> = { minor: 'Minor', annoying: 'Annoying', blocking: 'Can’t use it' };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function age(iso: string): string {
  const mins = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const firstLine = (t: Ticket) => {
  const line = t.message.split('\n').find((l) => l.trim()) ?? t.message;
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari or a non-secure page: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* handled below */ }
    ta.remove();
    return ok;
  }
}

const post = (url: string, method: string, body: unknown) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function TicketsPanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const pickedFilter = useRef(false);
  const [kind, setKind] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>('active');
  const [copied, setCopied] = useState<{ ids: string[]; text: string; failed: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tickets', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load tickets');
      const body = await res.json();
      setTickets(body.tickets); setAccounts(body.accounts); setEnabled(body.enabledUserIds);
      // First load: open on the first status that has something, rather than an empty "Open".
      if (!pickedFilter.current) {
        pickedFilter.current = true;
        const list = body.tickets as Ticket[];
        const first = (['open', 'in_progress'] as const).find((s) => list.some((t) => t.status === s));
        setFilter(first ?? (list.length ? 'all' : 'open'));
      }
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
    const res = await post('/api/admin/tickets', 'PUT', { enabledUserIds: next });
    if (!res.ok) { setEnabled(before); setNotice({ kind: 'error', text: 'Could not save that' }); }
  }

  function merge(changed: Ticket[]) {
    const byId = new Map(changed.map((t) => [t.id, t]));
    setTickets((list) => list.map((x) => byId.get(x.id) ?? x));
  }

  async function toggleOpen(t: Ticket) {
    if (openId === t.id) { setOpenId(null); return; }
    setOpenId(t.id);
    if (!t.seenAt) {
      const res = await post(`/api/admin/tickets/${t.id}`, 'PATCH', { seen: true });
      if (res.ok) merge([(await res.json()).ticket]);
    }
  }

  async function save(t: Ticket, patch: Record<string, unknown>, done?: string) {
    const res = await post(`/api/admin/tickets/${t.id}`, 'PATCH', patch);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: 'error', text: body.error || 'Could not save that' }); return; }
    merge([body.ticket]);
    if (done) setNotice({ kind: 'success', text: done });
  }

  async function remove(t: Ticket) {
    if (!window.confirm('Delete this ticket and its image? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/tickets/${t.id}`, { method: 'DELETE' });
    if (!res.ok) { setNotice({ kind: 'error', text: 'Could not delete that' }); return; }
    setTickets((list) => list.filter((x) => x.id !== t.id));
    setSelected((s) => { const n = new Set(s); n.delete(t.id); return n; });
    setOpenId(null);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length };
    for (const t of tickets) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tickets]);
  const newCount = tickets.filter((t) => !t.seenAt).length;
  const shown = tickets.filter((t) => (filter === 'all' || t.status === filter) && (kind === 'all' || t.kind === kind));

  const forScope = (s: Scope) => tickets.filter((t) => (s === 'all' ? true : s === 'selected' ? selected.has(t.id) : t.status === 'open' || t.status === 'in_progress'));
  const toCopy = forScope(scope);

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setScope('selected');
  }

  async function copyForClaude() {
    if (toCopy.length === 0) { setNotice({ kind: 'error', text: 'No tickets to copy for that choice' }); return; }
    const text = buildPrompt(toCopy);
    const ok = await copyText(text);
    setCopied({ ids: toCopy.filter((t) => t.status === 'open').map((t) => t.id), text, failed: !ok });
    if (ok) setNotice({ kind: 'success', text: `Copied ${toCopy.length} ticket${toCopy.length === 1 ? '' : 's'}. Paste it into Claude Code.` });
  }

  async function markInProgress() {
    if (!copied?.ids.length) return;
    const res = await post('/api/admin/tickets/bulk', 'POST', { updates: copied.ids.map((id) => ({ id, status: 'in_progress' })) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: 'error', text: body.error || 'Could not update them' }); return; }
    merge(body.changed);
    setNotice({ kind: 'success', text: `Marked ${body.changed.length} in progress` });
    setCopied(null);
  }

  return (
    <div className="tkp">
      {notice && <div className={`adm-notice is-${notice.kind}`} role="status" onClick={() => setNotice(null)}>{notice.text}</div>}

      <section className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2>Tickets {newCount > 0 && <span className="adm-badge is-new">{newCount} new</span>}</h2>
            <p>Newest first. A dot means you haven’t opened it yet. Tap a ticket to open it.</p>
          </div>
          <button type="button" className="tkp-btn" onClick={() => void load()}>Refresh</button>
        </div>

        <div className="tkp-filters" role="tablist" aria-label="Status">
          {([...STATUSES, { id: 'all', label: 'All' }] as { id: Filter; label: string }[]).map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'is-on' : ''} onClick={() => setFilter(f.id)}>
              {f.label} <span>{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="tkp-filters is-kinds" role="tablist" aria-label="Kind">
          {KIND_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={kind === f.id} className={kind === f.id ? 'is-on' : ''} onClick={() => setKind(f.id)}>{f.label}</button>
          ))}
        </div>

        <div className="tkp-list">
          {loaded && shown.length === 0 && <p className="adm-muted">Nothing here.</p>}
          {shown.map((t) => (
            <article key={t.id} className={`tkp-card${openId === t.id ? ' is-open' : ''}`}>
              <div className="tkp-card-top">
                <label className="tkp-pick" aria-label="Select for Claude">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
                </label>
                <button type="button" className="tkp-card-main" aria-expanded={openId === t.id} onClick={() => void toggleOpen(t)}>
                  <span className="tkp-line">
                    <span className={`tkp-dot${t.seenAt ? '' : ' is-new'}`} role={t.seenAt ? undefined : 'img'} aria-label={t.seenAt ? undefined : 'New'} />
                    <strong>{KIND_ICON[t.kind] ?? '📝'} {firstLine(t)}</strong>
                  </span>
                  <span className="tkp-sub">
                    <span className={`tkp-status is-${t.status}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                    <span>{t.context.path}</span><span>{displayName(t)}</span><span>{age(t.createdAt)}</span>
                    {(t.comments?.length ?? 0) > 0 && <span>💬 {t.comments!.length}</span>}
                  </span>
                </button>
              </div>
              {openId === t.id && <Detail key={t.id} t={t} onSave={save} onDelete={remove} />}
            </article>
          ))}
        </div>
      </section>

      <ReportCard tickets={tickets} onApplied={(changed, text) => { merge(changed); setNotice({ kind: 'success', text }); }} onError={(text) => setNotice({ kind: 'error', text })} />

      <details className="adm-card tkp-who">
        <summary>Who can send feedback</summary>
        <p className="adm-muted">Accounts ticked here get a small Feedback button at the bottom of every page. You always have it.</p>
        <div className="tkp-accounts">
          {accounts.length === 0 && loaded && <p className="adm-muted">No accounts yet.</p>}
          {accounts.map((a) => (
            <label key={a.id} className="adm-check">
              <input type="checkbox" checked={enabled.includes(a.id)} onChange={(e) => void toggleAccount(a.id, e.target.checked)} /> {a.username}
            </label>
          ))}
        </div>
      </details>

      {/* Sticks above the phone dock (--dock-h already includes the safe area). */}
      <div className="tkp-bar">
        {copied && (
          <div className="tkp-after">
            {copied.failed ? (
              <>
                <p>Your browser wouldn’t copy it. Select all below and copy by hand.</p>
                <textarea className="tkp-text" readOnly rows={5} value={copied.text} onFocus={(e) => e.currentTarget.select()} />
              </>
            ) : (
              <p>✅ Copied.</p>
            )}
            <div className="tkp-row">
              {copied.ids.length > 0 && <button type="button" className="tkp-btn is-primary" onClick={() => void markInProgress()}>Mark {copied.ids.length} open as in progress</button>}
              <button type="button" className="tkp-btn" onClick={() => setCopied(null)}>{copied.ids.length > 0 ? 'Not now' : 'Close'}</button>
            </div>
          </div>
        )}
        <div className="tkp-row">
          <button type="button" className="tkp-btn is-primary is-big" disabled={toCopy.length === 0} onClick={() => void copyForClaude()}>📋 Copy for Claude ({toCopy.length})</button>
          <div className="tkp-scope" role="radiogroup" aria-label="Which tickets">
            {([['active', 'Open + in progress'], ['all', 'All'], ['selected', `Selected (${selected.size})`]] as [Scope, string][]).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={scope === id} className={scope === id ? 'is-on' : ''} onClick={() => setScope(id)}>{label}</button>
            ))}
          </div>
          {selected.size > 0 && <button type="button" className="tkp-btn" onClick={() => { setSelected(new Set()); if (scope === 'selected') setScope('active'); }}>Clear</button>}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ tickets, onApplied, onError }: { tickets: Ticket[]; onApplied: (changed: Ticket[], text: string) => void; onError: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);

  function read() {
    const parsed = parseReport(text);
    setReport(parsed);
    setProblem(parsed ? '' : 'I couldn’t find a JSON list of updates in that. Paste Claude’s whole last message, including the ```json block.');
  }

  const known = report?.updates.filter((u) => byId.has(u.id)) ?? [];
  const unknown = report?.updates.filter((u) => !byId.has(u.id)) ?? [];

  async function apply() {
    if (!known.length) return;
    setBusy(true);
    try {
      const res = await post('/api/admin/tickets/bulk', 'POST', { updates: known });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not apply that');
      onApplied(body.changed, `Updated ${body.changed.length} ticket${body.changed.length === 1 ? '' : 's'}`);
      setText(''); setReport(null); setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not apply that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="adm-card tkp-who" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Paste Claude’s report</summary>
      <p className="adm-muted">Paste Claude’s last message. I’ll read its JSON block, show what would change, and apply it when you say so.</p>
      <textarea className="tkp-text" rows={6} value={text} placeholder="Paste here…" onChange={(e) => { setText(e.target.value); setReport(null); setProblem(''); }} />
      <div className="tkp-row">
        <button type="button" className="tkp-btn" disabled={!text.trim()} onClick={read}>Read it</button>
      </div>
      {problem && <p className="tkp-error" role="alert">{problem}</p>}
      {report && (
        <div className="tkp-preview">
          {known.map((u) => {
            const t = byId.get(u.id)!;
            return (
              <div key={u.id} className="tkp-change">
                <strong>{KIND_ICON[t.kind] ?? '📝'} {firstLine(t)}</strong>
                {u.status && <span>{STATUS_LABEL[t.status]} → <b>{STATUS_LABEL[u.status]}</b></span>}
                {u.reply && <span className="tkp-quote">Reply: {u.reply}</span>}
              </div>
            );
          })}
          {unknown.length > 0 && <p className="adm-muted">No ticket with id: {unknown.map((u) => u.id).join(', ')} (skipped)</p>}
          {report.skipped.map((s) => <p key={s} className="adm-muted">Skipped: {s}</p>)}
          {known.length === 0 && <p className="adm-muted">Nothing to apply.</p>}
          {known.length > 0 && <button type="button" className="tkp-btn is-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Applying…' : `Apply ${known.length} change${known.length === 1 ? '' : 's'}`}</button>}
        </div>
      )}
    </details>
  );
}

function Detail({ t, onSave, onDelete }: {
  t: Ticket;
  onSave: (t: Ticket, patch: Record<string, unknown>, done?: string) => Promise<void>;
  onDelete: (t: Ticket) => Promise<void>;
}) {
  const [reply, setReply] = useState(t.reply?.text ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const c = t.context;
  const rows: [string, string | undefined][] = [
    ['Account', `${t.username} (${t.userId})`],
    ['Filed', `${new Date(t.createdAt).toLocaleString()}${c.timezone ? ` (their time zone: ${c.timezone})` : ''}`],
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
    <div className="tkp-detail">
      <div className="tkp-meta">
        <span className="adm-badge">{KIND_ICON[t.kind]} {t.kind}</span>
        {t.severity && <span className="adm-badge is-warn">{SEVERITY_LABEL[t.severity] ?? t.severity}</span>}
        <span className="adm-muted">{t.username} · {when(t.createdAt)}</span>
      </div>
      <p className="tkp-message">{t.message}</p>

      {(t.comments ?? []).map((cm, i) => (
        <div key={i} className="tkp-comment"><span className="adm-muted">Follow-up · {when(cm.at)}</span><p>{cm.text}</p></div>
      ))}

      {t.image && (
        <a href={`/api/tickets/files/${t.image}`} target="_blank" rel="noreferrer"><img className="tkp-image" src={`/api/tickets/files/${t.image}`} alt="Attached by the sender" /></a>
      )}

      <p><a className="adm-link-btn" href={c.path} target="_blank" rel="noreferrer">Open {c.path} ↗</a></p>

      <div className="tkp-row" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s.id} type="button" className={`tkp-chip${t.status === s.id ? ' is-on' : ''}`} onClick={() => void onSave(t, { status: s.id })}>{s.label}</button>
        ))}
      </div>

      <label className="adm-field">Reply (they will see this)
        <textarea className="tkp-text" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
      </label>
      <div><button type="button" className="tkp-btn" disabled={reply.trim() === (t.reply?.text ?? '')} onClick={() => void onSave(t, { reply }, 'Reply saved')}>Save reply</button></div>

      <label className="adm-field">Private note (only you)
        <textarea className="tkp-text" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div><button type="button" className="tkp-btn" disabled={note.trim() === (t.note ?? '')} onClick={() => void onSave(t, { note }, 'Note saved')}>Save note</button></div>

      <h3 className="adm-h3">What was captured</h3>
      <dl className="tkp-dl">
        {rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        <div><dt>Recent errors</dt><dd>{c.errors.length ? c.errors.join('\n') : 'none'}</dd></div>
      </dl>

      <div><button type="button" className="tkp-btn is-danger" onClick={() => void onDelete(t)}>Delete ticket</button></div>
    </div>
  );
}
