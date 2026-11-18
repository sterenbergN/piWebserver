'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { skillsGet, skillsPost, SignedOut, fmtLevel, type SubjectResponse } from '@/components/skills/api';
import { arrowTabs, ConfidenceChip, ErrorNote, LevelBar, LevelText, Loading, SignedOutCard, TierBadge } from '@/components/skills/Ui';
import Overview from '@/components/skills/subject/Overview';

// Each tab's code comes when the tab is opened, not all of it with the page: together they were
// over a megabyte of script, most of it for tabs that weren't looked at.
const tabLoading = () => <Loading rows={2} />;
const KnowledgeVault = dynamic(() => import('@/components/skills/KnowledgeVault'), { loading: tabLoading });
const Projects = dynamic(() => import('@/components/skills/subject/Projects'), { loading: tabLoading });
const Questions = dynamic(() => import('@/components/skills/subject/Questions'), { loading: tabLoading });
const Resources = dynamic(() => import('@/components/skills/subject/Resources'), { loading: tabLoading });
const Steps = dynamic(() => import('@/components/skills/subject/Steps'), { loading: tabLoading });
const SubjectEditor = dynamic(() => import('@/components/skills/subject/SubjectEditor'), { loading: tabLoading });
const Topics = dynamic(() => import('@/components/skills/subject/Topics'), { loading: tabLoading });
import { STATUS_LABEL } from '@/lib/skills/types';
import { tierOf } from '@/lib/skills/model';

// One subject: header with its level & parent/subskill links, then tabs.
// The tab lives in the URL (?tab=) so links from the board and next steps
// land on the right one.

// Each tab says what it's for under the bar, so the names don't have to explain themselves.
const TABS = [
  { id: 'overview', label: 'Overview', hint: 'Where you stand, and what to do next.' },
  { id: 'steps', label: 'Steps', hint: 'Your study plan for this subject, in order. Today’s tasks come from these.' },
  { id: 'topics', label: 'Topics', hint: 'The parts of the subject, and how well you know each one.' },
  { id: 'resources', label: 'Resources', hint: 'Books, courses, papers and videos you’re working through.' },
  { id: 'projects', label: 'Projects', hint: 'Things you build or do to put it into practice.' },
  { id: 'questions', label: 'Quiz', hint: 'The questions Review tests you on. How you answer them sets your level.' },
  { id: 'knowledge', label: 'Notes & lookups', hint: 'Your notes, and things you want to look up, linked like a wiki. Press ? on any page to add a lookup.' },
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
    else if (!url.hash.startsWith('#r-')) setTab('overview');
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

  if (state === 'signed-out') return <div className="sk"><SignedOutCard /></div>;
  if (state === 'loading') return <div className="sk"><Loading rows={3} /></div>;
  if (state === 'error' || !data) {
    return (
      <div className="sk">
        <Link className="sk-back" href="/skills">← Skills</Link>
        <ErrorNote>{error || 'Couldn’t load that subject.'}</ErrorNote>
      </div>
    );
  }

  const { subject, stats } = data;
  const tabProps = { data, reload: load };

  const allSubjects = data.allSubjects ?? [];
  const subjectById = new Map(allSubjects.map((s) => [s.id, s]));
  const parents = (subject.parentIds ?? [])
    .map((pid) => subjectById.get(pid))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const subskills = allSubjects.filter((s) => s.parentIds.includes(subject.id));
  const stepsCount = subject.steps?.length ?? 0;
  const projectsCount = subject.resources.filter((r) => r.kind === 'project').length;
  const openInquiriesCount = (data.inquiries ?? []).filter((q) => q.status === 'open').length;

  return (
    <div className="sk">
      <header className="sk-subject-head">
        <Link className="sk-back" href="/skills">← Skills</Link>
        <div className="sk-subject-title">
          <span className="sk-subject-icon" aria-hidden>{subject.icon}</span>
          <div>
            <h1>{subject.name}</h1>
            <p className="sk-subject-sub">{STATUS_LABEL[subject.status]} · {subject.area}</p>
            {(parents.length > 0 || subskills.length > 0) && (
              <div className="sk-subject-relations">
                {parents.length > 0 && (
                  <span className="sk-rel-group">
                    <span className="sk-muted">Part of:</span>
                    {parents.map((p) => (
                      <Link key={p.id} href={`/skills/${p.id}`} className="sk-rel-pill">
                        <span aria-hidden>{p.icon}</span> {p.name}
                      </Link>
                    ))}
                  </span>
                )}
                {subskills.length > 0 && (
                  <span className="sk-rel-group">
                    <span className="sk-muted">Subskills:</span>
                    {subskills.map((sub) => (
                      <Link key={sub.id} href={`/skills/${sub.id}`} className="sk-rel-pill">
                        <span aria-hidden>{sub.icon}</span> {sub.name}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            )}
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
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </header>

      {editing && <SubjectEditor {...tabProps} onDone={() => setEditing(false)} onDelete={remove} deleting={deleting} />}

      <div className="sk-tabs" role="tablist" aria-label="Subject sections" onKeyDown={arrowTabs}>
        {TABS.map((t) => {
          const count =
            t.id === 'steps'
              ? stepsCount
              : t.id === 'projects'
                ? projectsCount
                : t.id === 'knowledge'
                  ? openInquiriesCount
                  : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`sk-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="sk-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {count > 0 && <span className="sk-tab-badge">{count}</span>}
            </button>
          );
        })}
      </div>
      <p className="sk-tab-hint">{TABS.find((t) => t.id === tab)?.hint}</p>
      <div id="sk-panel" role="tabpanel" aria-labelledby={`sk-tab-${tab}`} className="sk-panel">
        {tab === 'overview' && (
          <Overview
            {...tabProps}
            goto={goto}
            setTab={setTab}
            onOpenEditor={() => {
              setEditing(true);
              requestAnimationFrame(() => {
                document.getElementById('sk-subject-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            }}
          />
        )}
        {tab === 'steps' && <Steps data={data} reload={load} onOpenPlan={() => router.push(`/skills/${id}/plan`)} />}
        {tab === 'topics' && <Topics {...tabProps} />}
        {tab === 'resources' && <Resources {...tabProps} />}
        {tab === 'projects' && <Projects data={data} reload={load} />}
        {tab === 'questions' && <Questions {...tabProps} />}
        {tab === 'knowledge' && (
          <KnowledgeVault
            subjectId={id}
            onNavigateSubjectTab={(next: string) => setTab(next)}
            onDataChanged={load}
          />
        )}
      </div>
      {popup}
    </div>
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
