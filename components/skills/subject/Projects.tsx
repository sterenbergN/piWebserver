'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { localToday } from '@/lib/habits/dates';
import {
  RESOURCE_STATUS_LABEL,
  RESOURCE_STATUSES,
  type ProjectAttachment,
  type ProjectAttachmentKind,
  type ProjectLogEntry,
  type Resource,
  type ResourceStatus,
  type Topic,
} from '@/lib/skills/types';
import type { SubjectResponse } from '../api';
import { ErrorNote } from '../Ui';
import { longDay, useAct } from './shared';
import './steps-projects.css';

// Project logs tab (Req #10): dedicated showcase + chronological milestone timeline
// with live MediaRecorder camera/screen video capture, zip/file storage, and links.

type Act = ReturnType<typeof useAct>['act'];

/** A little under the 100 MB a request can be through Cloudflare, with room for the form around the file. */
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
/** A recording is stopped here, while it can still be saved. */
const MAX_RECORDING_BYTES = 90 * 1024 * 1024;

const FILE_ACCEPT = '.zip,.tar.gz,.tgz,.7z,.mp4,.webm,.mov,.png,.jpg,.jpeg,.webp,.pdf,.step,.stl,.obj,.glb,*';

function formatBytes(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function downloadHref(url: string) {
  if (!url.startsWith('/api/skills/projects/file')) return url;
  return url.includes('?') ? `${url}&download=1` : `${url}?download=1`;
}

function fileIconFor(att: ProjectAttachment) {
  if (att.kind === 'zip') return '🗜️';
  const lower = att.name.toLowerCase();
  if (/\.(stl|step|stp|obj|glb|gltf|3mf|iges)$/.test(lower)) return '🧊';
  if (lower.endsWith('.pdf')) return '📄';
  if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(lower)) return '🗜️';
  return '📎';
}

function tempAttachmentId() {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function uploadProjectFileToServer(
  file: Blob,
  filename: string,
  kindHint?: ProjectAttachmentKind,
): Promise<ProjectAttachment> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${filename} is over the 95 MB a project file can be. A link to it works for anything bigger.`);
  const form = new FormData();
  form.append('file', file, filename);
  form.append('name', filename);
  if (kindHint) form.append('kind', kindHint);

  const res = await fetch('/api/skills/projects/file', {
    method: 'POST',
    body: form,
  });
  if (res.status === 401) throw new Error('Please sign in to upload project files.');
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || !body.attachment) {
    throw new Error(body.message || 'Could not upload project file.');
  }
  return body.attachment as ProjectAttachment;
}

async function deleteStoredFileIfOwned(url: string) {
  if (!url.startsWith('/api/skills/projects/file')) return;
  try {
    const parsed = new URL(url, window.location.origin);
    const id = parsed.searchParams.get('id');
    if (!id) return;
    await fetch(`/api/skills/projects/file?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup of unreferenced uploads.
  }
}

/** Highlight [[wiki-links]] and #tags inside milestone notes cleanly in React. */
function renderRichNote(note: string): ReactNode[] {
  const tokenRegex = /\[\[([^[\]]+)\]\]|(^|[\s(])(#[a-zA-Z][a-zA-Z0-9_-]{0,48})/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(note)) !== null) {
    if (match.index > last) {
      parts.push(note.slice(last, match.index));
    }
    if (match[1] !== undefined) {
      const [target, alias] = match[1].split('|');
      parts.push(
        <span key={key++} className="sk-wikilink" title={`Wiki link: ${target.trim()}`}>
          {(alias ?? target).trim()}
        </span>,
      );
    } else {
      if (match[2]) parts.push(match[2]);
      parts.push(
        <span key={key++} className="sk-hashtag">
          {match[3]}
        </span>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < note.length) parts.push(note.slice(last));
  return parts;
}

export default function Projects({ data, reload }: { data: SubjectResponse; reload: () => Promise<void> }) {
  const { subject } = data;
  const { act, busy, error } = useAct(data, reload);
  const [showcase, setShowcase] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const projects = subject.resources.filter((r) => r.kind === 'project');
  const totalLogs = projects.reduce((sum, p) => sum + (p.logs?.length ?? 0), 0);

  return (
    <>
      <section className="sk-card">
        <div className="sk-proj-toolbar">
          <div className="sk-proj-toolbar-meta">
            <h2>Projects &amp; Build Logs</h2>
            <p className="sk-hint">
              {projects.length} project{projects.length === 1 ? '' : 's'} · {totalLogs} milestone log{totalLogs === 1 ? '' : 's'}
            </p>
          </div>
          <div className="sk-actions">
            <button
              type="button"
              className="sk-small-btn"
              aria-pressed={showcase}
              onClick={() => {
                setShowcase(!showcase);
                if (!showcase) setAddingProject(false);
              }}
            >
              ✨ {showcase ? 'Exit Showcase Mode' : 'Showcase Mode'}
            </button>
            {!showcase && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setAddingProject(!addingProject)}
              >
                {addingProject ? 'Close form' : '+ New Project'}
              </button>
            )}
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {addingProject && !showcase && (
          <NewProjectForm
            topics={subject.topics}
            busy={busy}
            onSubmit={async (values) => {
              if (await act('add-resource', { kind: 'project', ...values })) {
                setAddingProject(false);
              }
            }}
            onCancel={() => setAddingProject(false)}
          />
        )}
      </section>

      {projects.length === 0 ? (
        <section className="sk-card">
          <div className="sk-step-empty">
            <p>
              No projects in <strong>{subject.name}</strong> yet. Track hands-on builds with chronological milestone logs,
              recorded camera or screen demo videos, zip deliverables, CAD files, and Showcase Mode.
            </p>
            {!showcase && !addingProject && (
              <button type="button" className="btn btn-primary" onClick={() => setAddingProject(true)}>
                + New Project
              </button>
            )}
          </div>
        </section>
      ) : (
        projects.map((project, idx) => (
          <ProjectCard
            key={project.id}
            project={project}
            allProjects={projects}
            topics={subject.topics}
            showcase={showcase}
            defaultComposerOpen={projects.length === 1 || (project.status === 'doing' && idx === 0)}
            act={act}
            busy={busy}
            onOpenImage={(url, name) => setLightbox({ url, name })}
          />
        ))
      )}

      {lightbox && (
        <div
          className="sk-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt={lightbox.name} onClick={(e) => e.stopPropagation()} />
          <div className="sk-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <strong>{lightbox.name}</strong>
            <a className="sk-small-btn" href={downloadHref(lightbox.url)} download={lightbox.name}>
              Download
            </a>
            <a className="sk-small-btn" href={lightbox.url} target="_blank" rel="noopener noreferrer">
              Open in tab ↗
            </a>
            <button type="button" className="sk-small-btn" onClick={() => setLightbox(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function NewProjectForm({
  topics,
  busy,
  onSubmit,
  onCancel,
}: {
  topics: Topic[];
  busy: boolean;
  onSubmit: (values: {
    title: string;
    author: string;
    url: string;
    detail: string;
    status: ResourceStatus;
    topicIds: string[];
    hours: string;
    progress: { done: number; total: number; unit: string } | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [detail, setDetail] = useState('');
  const [status, setStatus] = useState<ResourceStatus>('doing');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [hours, setHours] = useState('');
  const [total, setTotal] = useState('');
  const [unit, setUnit] = useState('milestones');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(total));
    const progress = n > 0 ? { done: 0, total: n, unit: unit.trim() || 'milestones' } : null;
    void onSubmit({
      title: title.trim(),
      author: author.trim(),
      url: url.trim(),
      detail: detail.trim(),
      status,
      topicIds,
      hours: hours.trim(),
      progress,
    });
  }

  return (
    <form className="sk-inline-form sk-log-composer" onSubmit={handleSubmit}>
      <h4>New project</h4>
      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Project title</span>
          <input value={title} maxLength={200} required placeholder="e.g. Liquid Bipropellant Test Stand" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sk-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ResourceStatus)}>
            {RESOURCE_STATUSES.map((s) => (
              <option key={s} value={s}>{RESOURCE_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Repo / project URL (optional)</span>
          <input type="url" inputMode="url" value={url} maxLength={600} placeholder="https://github.com/..." onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="sk-field">
          <span>Who it&apos;s for / context (optional)</span>
          <input value={author} maxLength={160} placeholder="Personal build, portfolio, club..." onChange={(e) => setAuthor(e.target.value)} />
        </label>
      </div>

      <label className="sk-field">
        <span>What to build</span>
        <textarea rows={2} value={detail} maxLength={1200} placeholder="Architecture, deliverables, and what done looks like" onChange={(e) => setDetail(e.target.value)} />
      </label>

      {topics.length > 0 && (
        <fieldset className="sk-topic-pick">
          <legend>Linked topics</legend>
          {topics.map((t) => (
            <label key={t.id} className="sk-check">
              <input
                type="checkbox"
                checked={topicIds.includes(t.id)}
                onChange={(e) => setTopicIds(e.target.checked ? [...topicIds, t.id] : topicIds.filter((id) => id !== t.id))}
              /> {t.name}
            </label>
          ))}
        </fieldset>
      )}

      <div className="sk-grid-3">
        <label className="sk-field">
          <span>Estimated hours</span>
          <input type="number" min={0} max={5000} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Optional" />
        </label>
        <label className="sk-field">
          <span>Target count (optional)</span>
          <input type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="e.g. 5" />
        </label>
        <label className="sk-field">
          <span>Unit</span>
          <input value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} placeholder="milestones" />
        </label>
      </div>

      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
        <button type="button" className="sk-text-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ProjectCard({
  project: r,
  allProjects,
  topics,
  showcase,
  defaultComposerOpen,
  act,
  busy,
  onOpenImage,
}: {
  project: Resource;
  allProjects: Resource[];
  topics: Topic[];
  showcase: boolean;
  defaultComposerOpen: boolean;
  act: Act;
  busy: boolean;
  onOpenImage: (url: string, name: string) => void;
}) {
  const { confirm, popup } = useSitePopup();
  const [composerOpen, setComposerOpen] = useState(defaultComposerOpen);
  const [newestFirst, setNewestFirst] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  const logs = r.logs ?? [];
  const sortedLogs = [...logs].sort((a, b) => {
    const cmp = a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt);
    return newestFirst ? -cmp : cmp;
  });

  const topicNames = r.topicIds
    .map((id) => topics.find((t) => t.id === id)?.name)
    .filter(Boolean) as string[];
  const p = r.progress;
  const setStatus = (status: ResourceStatus) => act('edit-resource', { resourceId: r.id, changes: { status } });
  const setDone = (done: number) =>
    p && act('edit-resource', { resourceId: r.id, changes: { progress: { ...p, done: Math.max(0, Math.min(p.total, Math.round(done) || 0)) } } });

  function urlStillUsedElsewhere(url: string, removedLogId: string) {
    return allProjects.some((proj) =>
      (proj.logs ?? []).some(
        (l) => !(proj.id === r.id && l.id === removedLogId) && l.attachments.some((a) => a.url === url),
      ),
    );
  }

  async function removeLog(entry: ProjectLogEntry) {
    const ok = await confirm({
      title: `Delete log "${entry.title}"?`,
      message: 'This removes the milestone entry and its attached deliverables from this project.',
      confirmLabel: 'Delete log',
      danger: true,
    });
    if (!ok) return;
    const saved = await act('remove-project-log', { resourceId: r.id, logId: entry.id });
    if (saved) {
      for (const att of entry.attachments) {
        if (!urlStillUsedElsewhere(att.url, entry.id)) {
          void deleteStoredFileIfOwned(att.url);
        }
      }
    }
  }

  return (
    <article className={`sk-card sk-proj-card${showcase ? ' is-showcase' : ''}`}>
      <div className="sk-proj-head">
        <div className="sk-proj-title-block">
          <div className="sk-proj-badges">
            <span className={`sk-status-pill is-${r.status}`}>{RESOURCE_STATUS_LABEL[r.status]}</span>
            <span className="sk-chip">{logs.length} log entr{logs.length === 1 ? 'y' : 'ies'}</span>
            {r.hours ? <span className="sk-chip">~{r.hours} hrs</span> : null}
          </div>
          <h3>
            {r.url ? (
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                <span aria-hidden>🛠️</span> {r.title}
              </a>
            ) : (
              <>
                <span aria-hidden>🛠️</span> {r.title}
              </>
            )}
          </h3>
        </div>

        <div className="sk-actions">
          {r.url && (
            <a className="sk-link-pill" href={r.url} target="_blank" rel="noopener noreferrer">
              🔗 Repo / Link ↗
            </a>
          )}
          {!showcase && (
            <>
              <select
                aria-label={`Status for ${r.title}`}
                value={r.status}
                disabled={busy}
                onChange={(e) => void setStatus(e.target.value as ResourceStatus)}
              >
                {RESOURCE_STATUSES.map((s) => (
                  <option key={s} value={s}>{RESOURCE_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button
                type="button"
                className="sk-small-btn"
                aria-expanded={composerOpen}
                onClick={() => setComposerOpen(!composerOpen)}
              >
                {composerOpen ? 'Hide log form' : '+ Add Log Entry'}
              </button>
            </>
          )}
        </div>
      </div>

      {r.author && <p className="sk-hint">{r.author}</p>}
      {r.detail && <p className="sk-res-detail">{r.detail}</p>}

      {topicNames.length > 0 && (
        <div className="sk-chips" aria-label="Linked topics">
          {topicNames.map((n) => <span key={n} className="sk-chip">{n}</span>)}
        </div>
      )}

      {p && (
        <div className="sk-progress">
          <div
            className="sk-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={p.total}
            aria-valuenow={p.done}
            aria-label={`${r.title} progress`}
          >
            <span style={{ width: `${Math.min(100, (p.done / p.total) * 100)}%` }} />
          </div>
          {!showcase ? (
            <div className="sk-progress-controls">
              <button type="button" className="sk-small-btn" disabled={busy || p.done <= 0} onClick={() => setDone(p.done - 1)}>−1</button>
              <label className="sk-progress-input">
                <span className="sk-sr">{p.unit} done</span>
                <input
                  key={p.done}
                  type="number"
                  min={0}
                  max={p.total}
                  defaultValue={p.done}
                  onBlur={(e) => { if (Number(e.target.value) !== p.done) void setDone(Number(e.target.value)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </label>
              <span className="sk-muted">of {p.total} {p.unit}</span>
              <button type="button" className="sk-small-btn" disabled={busy || p.done >= p.total} onClick={() => setDone(p.done + 1)}>+1</button>
            </div>
          ) : (
            <p className="sk-hint">{p.done} of {p.total} {p.unit}</p>
          )}
        </div>
      )}

      {!showcase && composerOpen && (
        <ProjectLogForm
          heading="Add Log Entry"
          submitLabel="Save Log Entry"
          busy={busy}
          onSubmit={async (values) => {
            const ok = await act('add-project-log', { resourceId: r.id, ...values });
            return ok;
          }}
        />
      )}

      <div className="sk-timeline-head">
        <h4>Milestone Timeline ({logs.length})</h4>
        {logs.length > 1 && (
          <button type="button" className="sk-text-btn" onClick={() => setNewestFirst(!newestFirst)}>
            Order: {newestFirst ? 'Newest first' : 'Chronological'}
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <p className="sk-hint">
          {showcase ? 'No milestone logs recorded yet.' : 'No milestone logs yet — record a demo video, upload a build zip, or write a progress note above.'}
        </p>
      ) : (
        <ol className="sk-timeline">
          {sortedLogs.map((entry) => (
            <li key={entry.id} className="sk-log-entry">
              {!showcase && editingLogId === entry.id ? (
                <ProjectLogForm
                  heading={`Edit: ${entry.title}`}
                  submitLabel="Save changes"
                  initial={entry}
                  busy={busy}
                  onCancel={() => setEditingLogId(null)}
                  onSubmit={async (values) => {
                    const ok = await act('edit-project-log', {
                      resourceId: r.id,
                      logId: entry.id,
                      changes: values,
                    });
                    if (ok) setEditingLogId(null);
                    return ok;
                  }}
                />
              ) : (
                <>
                  <div className="sk-log-head">
                    <h5>{entry.title}</h5>
                    <span className="sk-log-day">{longDay(entry.day)}</span>
                  </div>

                  {entry.note && <p className="sk-log-note">{renderRichNote(entry.note)}</p>}

                  {entry.attachments.length > 0 && (
                    <AttachmentGallery attachments={entry.attachments} onOpenImage={onOpenImage} />
                  )}

                  {!showcase && (
                    <div className="sk-row-actions">
                      <button type="button" className="sk-text-btn" onClick={() => setEditingLogId(entry.id)}>Edit</button>
                      <button type="button" className="sk-text-btn is-danger" onClick={() => void removeLog(entry)}>Delete</button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {r.takeaways && (
        <div className="sk-step-empty">
          <strong>Takeaways</strong>
          <p>{r.takeaways}</p>
        </div>
      )}
      {popup}
    </article>
  );
}

function AttachmentGallery({
  attachments,
  onOpenImage,
}: {
  attachments: ProjectAttachment[];
  onOpenImage: (url: string, name: string) => void;
}) {
  const mediaAndFiles = attachments.filter((a) => a.kind !== 'link');
  const links = attachments.filter((a) => a.kind === 'link');

  return (
    <>
      {mediaAndFiles.length > 0 && (
        <div className="sk-att-grid">
          {mediaAndFiles.map((att) => {
            if (att.kind === 'video') {
              return (
                <div key={att.id} className="sk-att-video-card">
                  <video className="sk-proj-video" controls preload="metadata" src={att.url} />
                  <div className="sk-att-meta">
                    <span className="sk-att-name" title={att.name}>🎬 {att.name}</span>
                    <div className="sk-actions">
                      {att.size ? <span className="sk-muted">{formatBytes(att.size)}</span> : null}
                      <a className="sk-text-btn" href={downloadHref(att.url)} download={att.name}>Download</a>
                    </div>
                  </div>
                </div>
              );
            }

            if (att.kind === 'image') {
              return (
                <div key={att.id} className="sk-att-image-card">
                  <button
                    type="button"
                    className="sk-proj-img-btn"
                    title={`View ${att.name} full size`}
                    onClick={() => onOpenImage(att.url, att.name)}
                  >
                    <img className="sk-proj-img" src={att.url} alt={att.name} />
                  </button>
                  <div className="sk-att-meta">
                    <span className="sk-att-name" title={att.name}>🖼️ {att.name}</span>
                    <div className="sk-actions">
                      {att.size ? <span className="sk-muted">{formatBytes(att.size)}</span> : null}
                      <button type="button" className="sk-text-btn" onClick={() => onOpenImage(att.url, att.name)}>Full size</button>
                      <a className="sk-text-btn" href={downloadHref(att.url)} download={att.name}>Download</a>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={att.id} className="sk-proj-file-card">
                <div className="sk-proj-file-info">
                  <span className="sk-proj-file-icon" aria-hidden>{fileIconFor(att)}</span>
                  <div className="sk-proj-file-text">
                    <strong title={att.name}>{att.name}</strong>
                    <span>{att.kind === 'zip' ? 'Archive deliverable' : 'Project file'}{att.size ? ` · ${formatBytes(att.size)}` : ''}</span>
                  </div>
                </div>
                <a className="sk-small-btn" href={downloadHref(att.url)} download={att.name}>
                  Download
                </a>
              </div>
            );
          })}
        </div>
      )}

      {links.length > 0 && (
        <div className="sk-chips" aria-label="External project links">
          {links.map((att) => (
            <a key={att.id} className="sk-link-pill" href={att.url} target="_blank" rel="noopener noreferrer">
              <span aria-hidden>🔗</span> {att.name} ↗
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function ProjectLogForm({
  heading,
  submitLabel,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  heading: string;
  submitLabel: string;
  initial?: ProjectLogEntry;
  busy: boolean;
  onSubmit: (values: { title: string; note: string; day: string; attachments: ProjectAttachment[] }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [day, setDay] = useState(initial?.day ?? localToday());
  const [note, setNote] = useState(initial?.note ?? '');
  const [attachments, setAttachments] = useState<ProjectAttachment[]>(initial?.attachments ?? []);

  const [canRecord, setCanRecord] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'camera' | 'screen' | null>(null);
  const [recStream, setRecStream] = useState<MediaStream | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [localError, setLocalError] = useState('');

  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRecRef = useRef(false);

  useEffect(() => {
    setCanRecord(
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof MediaRecorder !== 'undefined',
    );
    return () => {
      cancelRecRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.srcObject = recStream;
    if (recStream) {
      previewRef.current.play().catch(() => {});
    }
  }, [recStream]);

  useEffect(() => {
    if (!recordingMode) {
      setRecSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setRecSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [recordingMode]);

  function stopTracks(stream: MediaStream | null) {
    stream?.getTracks().forEach((t) => t.stop());
    if (streamRef.current === stream) streamRef.current = null;
    setRecStream(null);
  }

  async function startRecording(mode: 'camera' | 'screen') {
    setLocalError('');
    if (!navigator.mediaDevices) {
      setLocalError('Media recording is not supported in this browser.');
      return;
    }

    let stream: MediaStream;
    try {
      if (mode === 'camera') {
        if (typeof navigator.mediaDevices.getUserMedia !== 'function') {
          setLocalError('Camera capture is unavailable here.');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
          const name = err instanceof DOMException ? err.name : '';
          if (name === 'NotAllowedError' || name === 'SecurityError') throw err;
          // Retry video-only if no microphone is present.
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      } else {
        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
          setLocalError('Screen capture is not supported in this browser.');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (err) {
          const name = err instanceof DOMException ? err.name : '';
          if (name === 'NotAllowedError' || name === 'AbortError' || name === 'SecurityError') throw err;
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        }
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        // A page reached by a link inside the site keeps the first page's permissions, which don't include the camera.
        setLocalError(mode === 'camera'
          ? 'The camera or microphone was refused. If you weren’t asked, reload this page and try again: the browser only asks on a page opened fresh.'
          : 'Screen recording permission was denied.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setLocalError('No camera device was found.');
      } else if (name === 'AbortError') {
        setLocalError('Screen selection was cancelled.');
      } else {
        setLocalError(err instanceof Error ? err.message : 'Could not start recording.');
      }
      return;
    }

    const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const supportedMime = typeof MediaRecorder.isTypeSupported === 'function'
      ? mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m))
      : undefined;

    let recorder: MediaRecorder;
    try {
      recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
    } catch (err) {
      stopTracks(stream);
      setLocalError(err instanceof Error ? err.message : 'Could not initialize video recorder.');
      return;
    }

    const chunks: BlobPart[] = [];
    let recorded = 0;
    cancelRecRef.current = false;
    streamRef.current = stream;
    recorderRef.current = recorder;
    setRecStream(stream);
    setRecordingMode(mode);

    recorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size <= 0) return;
      chunks.push(ev.data);
      recorded += ev.data.size;
      // Stop while it can still be saved: a recording over the upload limit would be lost whole.
      if (recorded > MAX_RECORDING_BYTES && recorder.state !== 'inactive') {
        setLocalError('That’s as long as a recording can be (about 90 MB). It was stopped and saved.');
        recorder.stop();
      }
    };

    recorder.onerror = () => {
      setLocalError('Recording failed unexpectedly.');
      setRecordingMode(null);
      stopTracks(stream);
    };

    recorder.onstop = () => {
      stopTracks(stream);
      setRecordingMode(null);
      recorderRef.current = null;
      if (cancelRecRef.current) return;

      const actualMime = recorder.mimeType || supportedMime || 'video/webm';
      const blob = new Blob(chunks, { type: actualMime });
      if (!blob.size) {
        setLocalError('Recorded video was empty.');
        return;
      }
      const ext = actualMime.includes('mp4') ? 'mp4' : 'webm';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${mode}-demo-${stamp}.${ext}`;
      setUploadStatus(`Uploading ${filename}…`);
      void uploadProjectFileToServer(blob, filename, 'video')
        .then((att) => {
          setAttachments((prev) => [...prev, att]);
          setUploadStatus('');
        })
        .catch((err) => {
          setUploadStatus('');
          setLocalError(err instanceof Error ? err.message : 'Could not upload recorded video.');
        });
    };

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack?.addEventListener('ended', () => {
      if (recorder.state !== 'inactive') recorder.stop();
    });

    recorder.start(500);
  }

  function stopAndAttachRecording() {
    cancelRecRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }

  function cancelRecording() {
    cancelRecRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      stopTracks(streamRef.current);
      setRecordingMode(null);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setLocalError('');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadStatus(`Uploading ${i + 1}/${files.length}: ${f.name}…`);
      try {
        const att = await uploadProjectFileToServer(f, f.name);
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : `Failed to upload ${f.name}.`);
        break;
      }
    }
    setUploadStatus('');
  }

  function addExternalLink() {
    setLocalError('');
    const rawUrl = linkUrl.trim();
    if (!/^https?:\/\/[^\s"<>]+$/.test(rawUrl)) {
      setLocalError('External link must start with https:// or http://');
      return;
    }
    const name = linkName.trim() || rawUrl;
    setAttachments((prev) => [...prev, { id: tempAttachmentId(), kind: 'link', name, url: rawUrl }]);
    setLinkName('');
    setLinkUrl('');
  }

  function removePendingAttachment(att: ProjectAttachment) {
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    if (!initial) {
      void deleteStoredFileIfOwned(att.url);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || recordingMode) return;
    setLocalError('');
    const ok = await onSubmit({
      title: title.trim(),
      note: note.trim(),
      day,
      attachments,
    });
    if (ok && !initial) {
      setTitle('');
      setNote('');
      setDay(localToday());
      setAttachments([]);
      setLinkName('');
      setLinkUrl('');
    }
  }

  return (
    <form className="sk-inline-form sk-log-composer" onSubmit={handleSubmit}>
      <h4>{heading}</h4>
      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Title</span>
          <input
            value={title}
            maxLength={200}
            required
            placeholder="e.g. First static fire test"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="sk-field">
          <span>Date</span>
          <input type="date" value={day} required onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>

      <label className="sk-field">
        <span>Milestone note</span>
        <textarea
          rows={3}
          maxLength={6000}
          value={note}
          placeholder="What you built, test observations, or lessons learned…"
          onChange={(e) => setNote(e.target.value)}
        />
        <small>Supports [[wiki-links]] and #tags for the Knowledge Vault.</small>
      </label>

      <div className="sk-media-controls">
        {canRecord && !recordingMode && (
          <>
            <button type="button" className="sk-small-btn" disabled={busy || !!uploadStatus} onClick={() => void startRecording('camera')}>
              📹 Record Camera
            </button>
            <button type="button" className="sk-small-btn" disabled={busy || !!uploadStatus} onClick={() => void startRecording('screen')}>
              🖥️ Record Screen
            </button>
          </>
        )}
        <label className="sk-small-btn sk-file-label" aria-disabled={busy || !!uploadStatus || !!recordingMode}>
          <span>📦 Upload Zip / Files</span>
          <input
            type="file"
            multiple
            accept={FILE_ACCEPT}
            disabled={busy || !!uploadStatus || !!recordingMode}
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {recordingMode && (
        <div className="sk-rec-box">
          <div className="sk-rec-bar">
            <span className="sk-rec-indicator">
              <i className="sk-rec-dot" aria-hidden />
              Recording {recordingMode === 'camera' ? 'camera' : 'screen'} · {formatDuration(recSeconds)}
            </span>
            <div className="sk-actions">
              <button type="button" className="btn btn-primary" onClick={stopAndAttachRecording}>
                Stop &amp; Attach
              </button>
              <button type="button" className="sk-text-btn" onClick={cancelRecording}>
                Discard
              </button>
            </div>
          </div>
          <video ref={previewRef} className="sk-rec-preview" muted autoPlay playsInline />
        </div>
      )}

      <div className="sk-link-attach-row">
        <input
          value={linkName}
          maxLength={200}
          placeholder="Link label (e.g. GitHub PR #12)"
          aria-label="External link label"
          onChange={(e) => setLinkName(e.target.value)}
        />
        <input
          type="url"
          inputMode="url"
          value={linkUrl}
          maxLength={1000}
          placeholder="https://..."
          aria-label="External link URL"
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <button type="button" className="sk-small-btn" disabled={!linkUrl.trim()} onClick={addExternalLink}>
          + Attach Link
        </button>
      </div>

      {uploadStatus && <p className="sk-hint">{uploadStatus}</p>}
      {localError && <p className="sk-warning" role="alert">{localError}</p>}

      {attachments.length > 0 && (
        <div className="sk-pending-list" aria-label="Attached deliverables">
          {attachments.map((att) => (
            <div key={att.id} className="sk-pending-chip">
              <span title={att.name}>
                {att.kind === 'video' ? '🎬' : att.kind === 'image' ? '🖼️' : att.kind === 'link' ? '🔗' : fileIconFor(att)}{' '}
                {att.name}{att.size ? ` (${formatBytes(att.size)})` : ''}
              </span>
              <button
                type="button"
                className="sk-text-btn is-danger"
                aria-label={`Remove ${att.name}`}
                onClick={() => removePendingAttachment(att)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sk-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !!uploadStatus || !!recordingMode || !title.trim()}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="sk-text-btn" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}
