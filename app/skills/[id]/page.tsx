'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { skillsGet, skillsPost, SignedOut, fmtLevel, type SubjectResponse } from '@/components/skills/api';
import { ConfidenceChip, ErrorNote, LevelBar, LevelText, Loading, SignedOutCard, TierBadge } from '@/components/skills/Ui';
import Overview from '@/components/skills/subject/Overview';
import Questions from '@/components/skills/subject/Questions';
import Resources from '@/components/skills/subject/Resources';
import SubjectEditor from '@/components/skills/subject/SubjectEditor';
import Topics from '@/components/skills/subject/Topics';
import { STATUS_LABEL } from '@/lib/skills/types';
import { tierOf } from '@/lib/skills/model';

// One subject: header with its level, then four tabs. The tab lives in the URL
// (?tab=) so links from the board and the next steps can land on the right one.

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'topics', label: 'Topics' },
  { id: 'resources', label: 'Resources' },
  { id: 'questions', label: 'Questions' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

function SubjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<SubjectResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrolled = useRef('');

  const param = search.get('tab');
  const tab: TabId = isTab(param) ? param : 'overview';

  const load = useCallback(async () => {
    try {
      setData(await skillsGet<SubjectResponse>({ subject: id }));
      setState('ready');
    } catch (e) {
      if (e instanceof SignedOut) setState('signed-out');
      else { setError(e instanceof Error ? e.message : 'Couldn’t load that subject.'); setState('error'); }
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const setTab = useCallback((next: string) => {
    const params = new URLSearchParams(window.location.search);
    if (next === 'overview') params.delete('tab'); else params.set('tab', next);
    const qs = params.toString();
    router.replace(`/skills/${id}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false });
  }, [id, router]);

  // A link to this same page (a next step pointing at ?tab=… or #r-…): switch tab here.
  const goto = useCallback((href: string) => {
    const url = new URL(href, window.location.origin);
    if (url.pathname !== `/skills/${id}`) return false;
    const next = url.searchParams.get('tab');
    if (next && isTab(next)) setTab(next);
    if (url.hash.startsWith('#r-')) {
      scrolled.current = '';
      window.history.replaceState(null, '', url.hash);
      setTab('resources');
      window.setTimeout(() => flash(url.hash.slice(1)), 60);
    }
    return true;
  }, [id, setTab]);

  // Arriving on /skills/<id>#r-<resource>: open Resources and show that card.
  useEffect(() => {
    if (state !== 'ready') return;
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith('r-') || scrolled.current === hash) return;
    if (tab !== 'resources') { if (!isTab(param)) setTab('resources'); return; }
    scrolled.current = hash;
    window.setTimeout(() => flash(hash), 60);
  }, [state, tab, param, setTab]);

  async function remove() {
    if (!data) return;
    const ok = await confirm({
      title: `Delete ${data.subject.name}?`,
      message: 'This removes every topic, resource, question and answer in it. This can’t be undone.',
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await skillsPost('remove-subject', { subjectId: id });
      router.push('/skills');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete it. Try again.');
      setDeleting(false);
    }
  }

  if (state === 'signed-out') return <main className="sk"><SignedOutCard /></main>;
  if (state === 'loading') return <main className="sk"><Loading rows={3} /></main>;
  if (state === 'error' || !data) {
    return (
      <main className="sk">
        <Link className="sk-back" href="/skills">← Skills</Link>
        <ErrorNote>{error || 'Couldn’t load that subject.'}</ErrorNote>
      </main>
    );
  }

  const { subject, stats } = data;
  const tabProps = { data, reload: load };

  return (
    <main className="sk">
      <header className="sk-subject-head">
        <Link className="sk-back" href="/skills">← Skills</Link>
        <div className="sk-subject-title">
          <span className="sk-subject-icon" aria-hidden>{subject.icon}</span>
          <div>
            <h1>{subject.name}</h1>
            <p className="sk-subject-sub">{STATUS_LABEL[subject.status]} · {subject.area}</p>
          </div>
          <TierBadge tier={tierOf(stats)} />
        </div>
        <div className="sk-subject-level">
          <LevelBar level={stats.level} fitted={stats.fitted} target={subject.target} size="lg" label={subject.name} />
          <div className="sk-subject-level-text">
            <LevelText level={stats.level} />
            <span className="sk-muted">target {subject.target}</span>
            {stats.fitted > stats.level + 0.05 && <span className="sk-muted">{fmtLevel(stats.fitted)} before fading</span>}
            <ConfidenceChip confidence={stats.confidence} />
          </div>
        </div>
        <div className="sk-actions">
          <Link className="btn btn-primary" href={`/skills/review?subject=${id}`}>Review{stats.due > 0 ? ` (${stats.due} due)` : ''}</Link>
          <Link className="btn btn-secondary" href={`/skills/${id}/questions`}>Write questions</Link>
          <Link className="btn btn-secondary" href={`/skills/${id}/plan`}>Plan with AI</Link>
          <button type="button" className="btn btn-secondary" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit'}</button>
          <button type="button" className="sk-text-btn is-danger" disabled={deleting} onClick={remove}>Delete subject</button>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </header>

      {editing && <SubjectEditor {...tabProps} onDone={() => setEditing(false)} />}

      <div className="sk-tabs" role="tablist" aria-label="Subject sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`sk-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="sk-panel" tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div id="sk-panel" role="tabpanel" aria-labelledby={`sk-tab-${tab}`} className="sk-panel">
        {tab === 'overview' && <Overview {...tabProps} goto={goto} setTab={setTab} />}
        {tab === 'topics' && <Topics {...tabProps} />}
        {tab === 'resources' && <Resources {...tabProps} />}
        {tab === 'questions' && <Questions {...tabProps} />}
      </div>
      {popup}
    </main>
  );
}

/** Scroll a resource card into view and let it glow for a moment. */
function flash(elementId: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.add('is-flash');
  window.setTimeout(() => el.classList.remove('is-flash'), 2200);
}

export default function Page() {
  return <Suspense><SubjectPage /></Suspense>;
}
