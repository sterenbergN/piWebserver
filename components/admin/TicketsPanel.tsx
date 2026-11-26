'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPrompt, displayName, otherTickets, parseReport, type ParsedReport } from '@/lib/tickets/prompt';
import type { LinkRelation, TicketEvent } from '@/lib/tickets/history';
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
const KIND_FILTERS = [{ id: 'all', label: 'All kinds' }, { id: 'bug', label: '🐞 Bugs' }, { id: 'idea', label: '💡 Ideas' }, { id: 'question', label: '❓ Questions' }, { id: 'other', label: '📝 Other' }, { id: 'auto', label: '🤖 Filed by the site' }, { id: 'people', label: '🙋 From people' }];
const SOURCE_LABEL: Record<string, string> = { browser: 'Error in someone’s browser', server: 'Server error', ai: 'AI problem', job: 'Background job', deploy: 'Install rolled back' };
const SEVERITY_LABEL: Record<string, string> = { minor: 'Minor', annoying: 'Annoying', blocking: 'Can’t use it' };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function age(iso: string): string {
  const mins = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const firstLine = (t: Ticket, max = 90) => {
  const line = t.message.split('\n').find((l) => l.trim()) ?? t.message;
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

const isClosed = (s: string) => s === 'done' || s === 'wontfix';
const REL_LABEL: Record<LinkRelation, string> = { related: 'Related', duplicate_of: 'Duplicate of', duplicated_by: 'Duplicated by' };
const REL_CHOICES: { id: LinkRelation; label: string }[] = [
  { id: 'related', label: 'Related to' }, { id: 'duplicate_of', label: 'This is a duplicate of' }, { id: 'duplicated_by', label: 'This is duplicated by' },
];
const WHO_LABEL: Record<string, string> = { reporter: 'Reporter', admin: 'You', site: 'The site', claude: 'Claude' };
const WHO_ICON: Record<string, string> = { reporter: '🙋', admin: '🛠️', site: '🤖', claude: '✳️' };

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

  async function save(t: Ticket, patch: Record<string, unknown>, done?: string): Promise<boolean> {
    const res = await post(`/api/admin/tickets/${t.id}`, 'PATCH', patch);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: 'error', text: body.error || 'Could not save that' }); return false; }
    // A link changes the other ticket too.
    merge(body.changed ?? [body.ticket]);
    if (done) setNotice({ kind: 'success', text: done });
    return true;
  }

  /** Open another ticket (from a link chip), showing it even if the filters hide it. */
  function openTicket(id: string) {
    const t = tickets.find((x) => x.id === id);
    if (!t) { setNotice({ kind: 'error', text: 'That ticket is gone' }); return; }
    if (!shown.some((x) => x.id === id)) { setFilter('all'); setKind('all'); }
    if (openId !== id) void toggleOpen(t);
    // After the previous card has closed, so the position is right.
    setTimeout(() => document.getElementById(`tkp-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
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
  const kindMatches = (t: Ticket) => kind === 'all' || (kind === 'auto' ? !!t.auto : kind === 'people' ? !t.auto : t.kind === kind);
  const shown = tickets.filter((t) => (filter === 'all' || t.status === filter) && kindMatches(t));

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
    // The newest other tickets go along so Claude can link new ones to them.
    const text = buildPrompt(toCopy, new Date(), otherTickets(tickets, toCopy));
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
            <article key={t.id} id={`tkp-${t.id}`} className={`tkp-card${openId === t.id ? ' is-open' : ''}`}>
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
                    {(t.links?.length ?? 0) > 0 && <span title="Linked tickets">🔗 {t.links!.length}</span>}
                    {t.auto && <span title={`Seen ${t.auto.count} times, last ${when(t.auto.lastSeen)}`}>🤖 ×{t.auto.count} · last {age(t.auto.lastSeen)}</span>}
                  </span>
                </button>
              </div>
              {openId === t.id && <Detail key={t.id} t={t} tickets={tickets} onSave={save} onDelete={remove} onOpen={openTicket} />}
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
      // Unknown related or duplicate ids are left out here; the server checks the rest again.
      const updates = known.map(({ duplicateOf, ...u }) => ({
        ...u,
        ...(u.related ? { related: u.related.filter((id) => byId.has(id)) } : {}),
        ...(duplicateOf && byId.has(duplicateOf) ? { duplicateOf } : {}),
      }));
      const res = await post('/api/admin/tickets/bulk', 'POST', { updates, source: 'claude' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not apply that');
      const skippedLinks: string[] = body.skippedLinks ?? [];
      onApplied(body.changed, `Updated ${body.changed.length} ticket${body.changed.length === 1 ? '' : 's'}${skippedLinks.length ? `. Links left out: ${skippedLinks.join('; ')}` : ''}`);
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
                {u.status && u.status !== t.status && <span>{STATUS_LABEL[t.status]} → <b>{STATUS_LABEL[u.status]}</b>{isClosed(t.status) && !isClosed(u.status) ? ' (reopens it; the reply is the reason)' : ''}</span>}
                {u.reply && <span className="tkp-quote">Reply: {u.reply}</span>}
                {u.commit && <span>Commit <code>{u.commit}</code></span>}
                {u.duplicateOf && <span>Duplicate of: {byId.has(u.duplicateOf) ? `${u.duplicateOf} (${firstLine(byId.get(u.duplicateOf)!, 40)})` : `${u.duplicateOf} (no such ticket, skipped)`}</span>}
                {u.related && u.related.length > 0 && (
                  <span>Links to: {u.related.map((id) => (byId.has(id) ? `${id} (${firstLine(byId.get(id)!, 40)})` : `${id} (no such ticket, skipped)`)).join(', ')}</span>
                )}
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

function Detail({ t, tickets, onSave, onDelete, onOpen }: {
  t: Ticket;
  tickets: Ticket[];
  onSave: (t: Ticket, patch: Record<string, unknown>, done?: string) => Promise<boolean>;
  onDelete: (t: Ticket) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [reply, setReply] = useState(t.reply?.text ?? '');
  const [note, setNote] = useState(t.note ?? '');
  // Reopening a closed ticket asks why first.
  const [reopen, setReopen] = useState<{ to: string; reason: string } | null>(null);
  const [commit, setCommit] = useState('');
  const byId = useMemo(() => new Map(tickets.map((x) => [x.id, x])), [tickets]);
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

  function pickStatus(to: string) {
    if (to === t.status) return;
    if (isClosed(t.status) && !isClosed(to)) { setReopen({ to, reason: '' }); return; }
    setReopen(null);
    void onSave(t, { status: to });
  }

  async function confirmReopen() {
    if (!reopen?.reason.trim()) return;
    if (await onSave(t, { status: reopen.to, reason: reopen.reason }, 'Reopened')) setReopen(null);
  }

  const validCommit = /^[0-9a-f]{7,40}$/i.test(commit.trim());

  return (
    <div className="tkp-detail">
      <div className="tkp-meta">
        <span className="adm-badge">{KIND_ICON[t.kind]} {t.kind}</span>
        {t.severity && <span className="adm-badge is-warn">{SEVERITY_LABEL[t.severity] ?? t.severity}</span>}
        <span className="adm-muted">{t.username} · {when(t.createdAt)} · <code className="tkp-id">{t.id}</code></span>
      </div>
      <p className="tkp-message">{t.message}</p>

      {t.auto && (
        <div className="tkp-auto">
          <p className="adm-muted" style={{ margin: 0 }}>
            🤖 {SOURCE_LABEL[t.auto.source] ?? t.auto.source}, noticed by the site itself. Seen <strong>{t.auto.count}</strong> time{t.auto.count === 1 ? '' : 's'}, first {when(t.auto.firstSeen)}, last {when(t.auto.lastSeen)}.
            {t.auto.reopened ? ` Came back ${t.auto.reopened} time${t.auto.reopened === 1 ? '' : 's'} after being marked done.` : ''}
          </p>
          {t.auto.pages.length > 0 && <p className="adm-muted" style={{ margin: 0 }}>Pages: {t.auto.pages.join(', ')}</p>}
          {t.auto.builds.length > 0 && <p className="adm-muted" style={{ margin: 0 }}>Builds: {t.auto.builds.join(', ')}</p>}
          {t.auto.samples.map((s, i) => <pre key={i} className="tkp-sample">{s}</pre>)}
        </div>
      )}

      {t.image && (
        <a href={`/api/tickets/files/${t.image}`} target="_blank" rel="noreferrer"><img className="tkp-image" src={`/api/tickets/files/${t.image}`} alt="Attached by the sender" /></a>
      )}

      <p><a className="adm-link-btn" href={c.path} target="_blank" rel="noreferrer">Open {c.path} ↗</a></p>

      <Links t={t} byId={byId} tickets={tickets} onSave={onSave} onOpen={onOpen} />

      <h3 className="adm-h3">Timeline</h3>
      <Timeline events={t.history ?? []} byId={byId} onOpen={onOpen} />

      <div className="tkp-row" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s.id} type="button" className={`tkp-chip${t.status === s.id ? ' is-on' : ''}${reopen?.to === s.id ? ' is-pending' : ''}`} onClick={() => pickStatus(s.id)}>{s.label}</button>
        ))}
      </div>
      {reopen && (
        <div className="tkp-reopen">
          <label className="adm-field">Why is it being reopened? {!t.auto && '(they will see this)'}
            <textarea className="tkp-text" rows={2} maxLength={500} autoFocus value={reopen.reason} placeholder="e.g. Still happens on the phone" onChange={(e) => setReopen({ ...reopen, reason: e.target.value })} />
          </label>
          <div className="tkp-row">
            <button type="button" className="tkp-btn is-primary" disabled={!reopen.reason.trim()} onClick={() => void confirmReopen()}>Reopen as {STATUS_LABEL[reopen.to]?.toLowerCase()}</button>
            <button type="button" className="tkp-btn" onClick={() => setReopen(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!t.auto && (<>
        <label className="adm-field">Reply (they will see this)
          <textarea className="tkp-text" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
        </label>
        <div><button type="button" className="tkp-btn" disabled={reply.trim() === (t.reply?.text ?? '')} onClick={() => void onSave(t, { reply }, 'Reply saved')}>Save reply</button></div>
      </>)}

      <label className="adm-field">Private note (only you)
        <textarea className="tkp-text" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div><button type="button" className="tkp-btn" disabled={note.trim() === (t.note ?? '')} onClick={() => void onSave(t, { note }, 'Note saved')}>Save note</button></div>

      <form className="tkp-row" onSubmit={(e) => { e.preventDefault(); if (validCommit) void onSave(t, { commit: commit.trim() }, 'Commit recorded').then((ok) => { if (ok) setCommit(''); }); }}>
        <input className="tkp-input tkp-commit-in" value={commit} maxLength={40} placeholder="Commit hash" aria-label="Commit that fixed it" spellCheck={false} autoCapitalize="off" onChange={(e) => setCommit(e.target.value)} />
        <button type="submit" className="tkp-btn" disabled={!validCommit}>Record commit</button>
      </form>

      <h3 className="adm-h3">What was captured</h3>
      <dl className="tkp-dl">
        {rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        <div><dt>Recent errors</dt><dd>{c.errors.length ? c.errors.join('\n') : 'none'}</dd></div>
      </dl>

      <div><button type="button" className="tkp-btn is-danger" onClick={() => void onDelete(t)}>Delete ticket</button></div>
    </div>
  );
}

/** A linked ticket as a chip: tap to open it. */
function LinkChip({ id, rel, byId, onOpen, onRemove }: { id: string; rel?: LinkRelation; byId: Map<string, Ticket>; onOpen: (id: string) => void; onRemove?: () => void }) {
  const other = byId.get(id);
  return (
    <span className={`tkp-link${other ? '' : ' is-gone'}`}>
      <button type="button" className="tkp-link-open" disabled={!other} title={other ? other.message.slice(0, 200) : 'Deleted'} onClick={() => onOpen(id)}>
        {rel && <span className="tkp-link-rel">{REL_LABEL[rel]}</span>}
        {other ? <>{KIND_ICON[other.kind] ?? '📝'} {firstLine(other, 42)} <span className={`tkp-status is-${other.status}`}>{STATUS_LABEL[other.status] ?? other.status}</span></> : <code>{id}</code>}
      </button>
      {onRemove && <button type="button" className="tkp-link-x" aria-label="Remove link" onClick={onRemove}>✕</button>}
    </span>
  );
}

function Links({ t, byId, tickets, onSave, onOpen }: {
  t: Ticket;
  byId: Map<string, Ticket>;
  tickets: Ticket[];
  onSave: (t: Ticket, patch: Record<string, unknown>, done?: string) => Promise<boolean>;
  onOpen: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [rel, setRel] = useState<LinkRelation>('related');
  const links = t.links ?? [];
  const linked = new Set(links.map((l) => l.id));
  const q = query.trim().toLowerCase();
  const matches = q.length < 2 ? [] : tickets
    .filter((x) => x.id !== t.id && !linked.has(x.id) && (x.id.toLowerCase().startsWith(q) || x.message.toLowerCase().includes(q)))
    .slice(0, 8);

  async function link(id: string) {
    if (await onSave(t, { link: { id, rel } }, 'Linked')) { setQuery(''); setAdding(false); }
  }

  return (
    <div className="tkp-links">
      {links.length > 0 && (
        <div className="tkp-link-list">
          {links.map((l) => (
            <LinkChip key={l.id} id={l.id} rel={l.rel} byId={byId} onOpen={onOpen} onRemove={() => void onSave(t, { unlink: l.id }, 'Unlinked')} />
          ))}
        </div>
      )}
      {!adding ? (
        <div><button type="button" className="tkp-btn" onClick={() => setAdding(true)}>🔗 Link a ticket</button></div>
      ) : (
        <div className="tkp-link-add">
          <select className="tkp-input" value={rel} aria-label="Kind of link" onChange={(e) => setRel(e.target.value as LinkRelation)}>
            {REL_CHOICES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input className="tkp-input" type="search" autoFocus value={query} placeholder="Search by id or words…" aria-label="Find a ticket to link" onChange={(e) => setQuery(e.target.value)} />
          {q.length >= 2 && matches.length === 0 && <p className="adm-muted" style={{ margin: 0 }}>No other ticket matches.</p>}
          {matches.length > 0 && (
            <ul className="tkp-link-results">
              {matches.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => void link(x.id)}>
                    <span>{KIND_ICON[x.kind] ?? '📝'} {firstLine(x, 70)}</span>
                    <span className="tkp-sub"><span className={`tkp-status is-${x.status}`}>{STATUS_LABEL[x.status] ?? x.status}</span><code>{x.id}</code><span>{age(x.createdAt)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div><button type="button" className="tkp-btn" onClick={() => { setAdding(false); setQuery(''); }}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

/** The ticket's timeline, oldest first, newest last. */
function Timeline({ events, byId, onOpen }: { events: TicketEvent[]; byId: Map<string, Ticket>; onOpen: (id: string) => void }) {
  if (!events.length) return <p className="adm-muted">Nothing yet.</p>;
  return (
    <ol className="tkp-tl">
      {events.map((e, i) => (
        <li key={i} className={`tkp-ev is-${e.kind} by-${e.by}`}>
          <div className="tkp-ev-head">
            <span className="tkp-ev-who">{WHO_ICON[e.by] ?? '•'} {WHO_LABEL[e.by] ?? e.by}</span>
            <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>{e.approx ? '≈ ' : ''}{when(e.at)}</time>
          </div>
          <div className="tkp-ev-body"><EventText e={e} byId={byId} onOpen={onOpen} /></div>
        </li>
      ))}
    </ol>
  );
}

function EventText({ e, byId, onOpen }: { e: TicketEvent; byId: Map<string, Ticket>; onOpen: (id: string) => void }) {
  switch (e.kind) {
    case 'filed': return <span>Filed it</span>;
    case 'status': return <span>{STATUS_LABEL[e.from] ?? e.from} → <b>{STATUS_LABEL[e.to] ?? e.to}</b></span>;
    case 'reopened': return <><span>Reopened: {STATUS_LABEL[e.from] ?? e.from} → <b>{STATUS_LABEL[e.to] ?? e.to}</b></span><p className="tkp-ev-text">{e.reason}</p></>;
    case 'reply': return e.text ? <><span>Replied</span><p className="tkp-ev-text">{e.text}</p></> : <span>Withdrew the reply</span>;
    case 'note': return e.text ? <><span>Private note</span><p className="tkp-ev-text is-private">{e.text}</p></> : <span>Cleared the private note</span>;
    case 'comment': return <><span>Added a follow-up</span><p className="tkp-ev-text">{e.text}</p></>;
    case 'linked': return <span className="tkp-ev-link">Linked <LinkChip id={e.other} rel={e.rel} byId={byId} onOpen={onOpen} /></span>;
    case 'unlinked': return <span className="tkp-ev-link">Unlinked <LinkChip id={e.other} byId={byId} onOpen={onOpen} /></span>;
    case 'commit': return (
      <span>Commit {e.hash
        ? <a className="tkp-commit" href="/stats/history" target="_blank" rel="noreferrer" title="Open the site history and search for it"><code>{e.hash.slice(0, 7)}</code> ↗</a>
        : 'recorded'}{e.message ? ` · ${e.message}` : ''}</span>
    );
    case 'seen_again': return <span>Seen again{e.build ? <> on <code>{e.build}</code></> : ''} ({e.count} so far)</span>;
    default: return null;
  }
}
