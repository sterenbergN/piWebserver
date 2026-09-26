'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import ResumeView from '@/components/resume/ResumeView';
import { NOW_SUGGESTIONS, PROJECT_CATEGORIES, type ExperienceEntry, type Project, type Resume, type Skill } from '@/lib/resume';
type Section = 'profile' | 'experience' | 'skills' | 'projects';

const newId = () => `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

const label: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0.75rem 0 0.3rem' };
const input: React.CSSProperties = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px', border: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', font: 'inherit' };
const card: React.CSSProperties = { border: '1px solid var(--surface-border)', borderRadius: '12px', padding: '1rem', marginBottom: '0.75rem', background: 'var(--surface-glass)' };

function RowControls({ index, count, onMove, onDelete, name }: { index: number; count: number; onMove: (to: number) => void; onDelete: () => void; name: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
      <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem' }} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${name} up`}>↑</button>
      <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem' }} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${name} down`}>↓</button>
      <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem', color: 'var(--danger)' }} onClick={onDelete} aria-label={`Delete ${name}`}>✕</button>
    </div>
  );
}

export default function ResumeEditor() {
  const { confirm, showAlert, popup } = useSitePopup();
  const [resume, setResume] = useState<Resume | null>(null);
  const [posts, setPosts] = useState<{ slug: string; title: string }[]>([]);
  const [section, setSection] = useState<Section>('profile');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [skillDraft, setSkillDraft] = useState('');
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/resume').then((r) => r.json()).then((d) => { if (d.success) setResume(d.resume); });
    fetch('/api/blog').then((r) => r.json()).then((d) => {
      if (d.success) setPosts(d.posts.map((p: { slug: string; title: string }) => ({ slug: p.slug, title: p.title })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!resume) return <div className="container"><p style={{ color: 'var(--muted)' }}>Loading resume…</p></div>;

  const update = (patch: Partial<Resume>) => { setResume({ ...resume, ...patch }); setDirty(true); };
  const setProfile = (patch: Partial<Resume['profile']>) => update({ profile: { ...resume.profile, ...patch } });
  const setJob = (i: number, patch: Partial<ExperienceEntry>) =>
    update({ experience: resume.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const setProject = (i: number, patch: Partial<Project>) =>
    update({ projects: resume.projects.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setSkill = (i: number, patch: Partial<Skill>) =>
    update({ skills: resume.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/resume', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resume) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      setResume(data.resume);
      setDirty(false);
      showAlert({ title: 'Saved', message: 'The home page and /resume are updated.' });
    } catch (err) {
      showAlert({ title: 'Could not save', message: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (what: string, apply: () => void) => {
    if (await confirm({ title: `Remove ${what}?`, message: 'It disappears from the site when you save.', confirmLabel: 'Remove', danger: true })) apply();
  };

  const addSkills = () => {
    // Accept a comma-separated list so a whole skills line can be pasted in.
    const names = skillDraft.split(',').map((s) => s.trim()).filter(Boolean);
    const existing = new Set(resume.skills.map((s) => s.name.toLowerCase()));
    const fresh = names.filter((n, i) => !existing.has(n.toLowerCase()) && names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
    if (fresh.length) update({ skills: [...resume.skills, ...fresh.map((name) => ({ id: newId(), name, linkedPosts: [] }))] });
    setSkillDraft('');
  };

  const tabs: { id: Section; label: string; count?: number }[] = [
    { id: 'profile', label: '👤 Header' },
    { id: 'experience', label: '💼 Experience', count: resume.experience.length },
    { id: 'skills', label: '🧠 Skills', count: resume.skills.length },
    { id: 'projects', label: '🛠 Projects', count: resume.projects.length },
  ];

  return (
    <div className="container" style={{ maxWidth: 1300 }}>
      {popup}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <Link href="/admin" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← Admin</Link>
          <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.8rem' }}>Resume & Home Page</h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
            Edit it like a resume — the home page and the printable <Link href="/resume" target="_blank" style={{ color: 'var(--accent)' }}>/resume</Link> update when you save.
            {dirty && <strong style={{ color: 'var(--warning)' }}> • Unsaved changes</strong>}
            {!dirty && resume.profile.updatedAt && <span> · Last saved {new Date(resume.profile.updatedAt).toLocaleString()}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary resume-preview-toggle" onClick={() => setShowPreview((v) => !v)}>{showPreview ? '✏️ Edit' : '👁 Preview'}</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : '💾 Save'}</button>
        </div>
      </div>

      <style>{`
        .resume-editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
        .resume-editor-preview { position: sticky; top: 5rem; max-height: calc(100vh - 6rem); overflow: auto; }
        .resume-preview-toggle { display: none; }
        @media (max-width: 960px) {
          .resume-editor-grid { grid-template-columns: 1fr; }
          .resume-preview-toggle { display: inline-flex; }
          .resume-editor-grid[data-preview="false"] .resume-editor-preview { display: none; }
          .resume-editor-grid[data-preview="true"] .resume-editor-form { display: none; }
          .resume-editor-preview { position: static; max-height: none; }
        }
      `}</style>

      <div className="resume-editor-grid" data-preview={showPreview}>
        <div className="resume-editor-form">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {tabs.map((t) => (
              <button key={t.id} className={section === t.id ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.45rem 0.9rem' }} onClick={() => setSection(t.id)}>
                {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
              </button>
            ))}
          </div>

          {section === 'profile' && (
            <div style={card}>
              <label style={label} htmlFor="r-name">Name</label>
              <input id="r-name" style={input} value={resume.profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
              <label style={label} htmlFor="r-headline">Headline</label>
              <textarea id="r-headline" style={{ ...input, minHeight: 70 }} value={resume.profile.headline} onChange={(e) => setProfile({ headline: e.target.value })} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 0.75rem' }}>
                <div>
                  <label style={label} htmlFor="r-email">Email</label>
                  <input id="r-email" type="email" style={input} value={resume.profile.email} onChange={(e) => setProfile({ email: e.target.value })} />
                </div>
                <div>
                  <label style={label} htmlFor="r-location">Location</label>
                  <input id="r-location" style={input} value={resume.profile.location} placeholder="City, State" onChange={(e) => setProfile({ location: e.target.value })} />
                </div>
              </div>
              <label style={label} htmlFor="r-summary">Summary <span style={{ textTransform: 'none', fontWeight: 400 }}>(printable resume)</span></label>
              <textarea id="r-summary" style={{ ...input, minHeight: 90 }} value={resume.profile.summary} onChange={(e) => setProfile({ summary: e.target.value })} />
              <label style={label} htmlFor="r-skills-intro">Skills intro <span style={{ textTransform: 'none', fontWeight: 400 }}>(home page)</span></label>
              <textarea id="r-skills-intro" style={{ ...input, minHeight: 60 }} value={resume.profile.skillsIntro} onChange={(e) => setProfile({ skillsIntro: e.target.value })} />

              <label style={label}>Links</label>
              {resume.profile.links.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input style={{ ...input, flex: '0 0 30%' }} value={l.label} placeholder="Label" aria-label="Link label"
                    onChange={(e) => setProfile({ links: resume.profile.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input style={input} value={l.url} placeholder="https://…" aria-label="Link URL"
                    onChange={(e) => setProfile({ links: resume.profile.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <RowControls index={i} count={resume.profile.links.length} name={l.label || 'link'}
                    onMove={(to) => setProfile({ links: move(resume.profile.links, i, to) })}
                    onDelete={() => setProfile({ links: resume.profile.links.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setProfile({ links: [...resume.profile.links, { label: '', url: '' }] })}>+ Add link</button>

              <label style={label}>Now <span style={{ textTransform: 'none', fontWeight: 400 }}>(home page — what you&apos;re up to lately)</span></label>
              <datalist id="now-labels">{NOW_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              {(resume.profile.now || []).map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input style={{ ...input, flex: '0 0 30%' }} list="now-labels" value={n.label} placeholder="Building" aria-label="Now label"
                    onChange={(e) => setProfile({ now: resume.profile.now.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input style={input} value={n.text} placeholder="A robot arm for the garage" aria-label="Now text"
                    onChange={(e) => setProfile({ now: resume.profile.now.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <RowControls index={i} count={resume.profile.now.length} name={n.label || 'item'}
                    onMove={(to) => setProfile({ now: move(resume.profile.now, i, to) })}
                    onDelete={() => setProfile({ now: resume.profile.now.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {(resume.profile.now || []).length < 6 && (
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }}
                  onClick={() => setProfile({ now: [...(resume.profile.now || []), { label: NOW_SUGGESTIONS[(resume.profile.now || []).length % NOW_SUGGESTIONS.length], text: '' }] })}>
                  + Add “Now” item
                </button>
              )}
            </div>
          )}

          {section === 'experience' && (
            <>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>Newest first — the top entry is shown as your current role.</p>
              <button className="btn btn-primary" style={{ marginBottom: '0.75rem' }}
                onClick={() => update({ experience: [{ id: newId(), role: '', company: '', period: '', description: '', details: [] }, ...resume.experience] })}>
                + Add position at top
              </button>
              {resume.experience.map((job, i) => (
                <div key={job.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{job.role || 'New position'}{job.company ? ` · ${job.company}` : ''}</strong>
                    <RowControls index={i} count={resume.experience.length} name={job.role || 'position'}
                      onMove={(to) => update({ experience: move(resume.experience, i, to) })}
                      onDelete={() => remove('this position', () => update({ experience: resume.experience.filter((_, j) => j !== i) }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 0.75rem' }}>
                    <div><label style={label}>Role</label><input style={input} value={job.role} onChange={(e) => setJob(i, { role: e.target.value })} /></div>
                    <div><label style={label}>Company</label><input style={input} value={job.company} onChange={(e) => setJob(i, { company: e.target.value })} /></div>
                    <div><label style={label}>Dates</label><input style={input} value={job.period} placeholder="Jan 2023 – Present" onChange={(e) => setJob(i, { period: e.target.value })} /></div>
                  </div>
                  <label style={label}>Summary</label>
                  <textarea style={{ ...input, minHeight: 60 }} value={job.description} onChange={(e) => setJob(i, { description: e.target.value })} />
                  <label style={label}>Highlights <span style={{ textTransform: 'none', fontWeight: 400 }}>(one per line)</span></label>
                  <textarea style={{ ...input, minHeight: 90 }} value={job.details.join('\n')}
                    onChange={(e) => setJob(i, { details: e.target.value.split('\n') })} />
                </div>
              ))}
            </>
          )}

          {section === 'skills' && (
            <div style={card}>
              <form onSubmit={(e) => { e.preventDefault(); addSkills(); }} style={{ display: 'flex', gap: '0.5rem' }}>
                <input style={input} value={skillDraft} placeholder="Add skills — e.g. SolidWorks, PLC, Python" onChange={(e) => setSkillDraft(e.target.value)} aria-label="New skills" />
                <button className="btn btn-primary" type="submit" disabled={!skillDraft.trim()}>Add</button>
              </form>
              <p style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Tap a skill to rename it or link blog posts that show it off.</p>
              {resume.skills.map((s, i) => (
                <div key={s.id} style={{ borderTop: '1px solid var(--surface-border)', padding: '0.5rem 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <button type="button" onClick={() => setOpenSkill(openSkill === s.id ? null : s.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--foreground)', font: 'inherit', fontWeight: 600, cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                      {s.name} {s.linkedPosts.length > 0 && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.8rem' }}>· {s.linkedPosts.length} post{s.linkedPosts.length === 1 ? '' : 's'}</span>}
                    </button>
                    <RowControls index={i} count={resume.skills.length} name={s.name}
                      onMove={(to) => update({ skills: move(resume.skills, i, to) })}
                      onDelete={() => update({ skills: resume.skills.filter((_, j) => j !== i) })} />
                  </div>
                  {openSkill === s.id && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <input style={input} value={s.name} aria-label="Skill name" onChange={(e) => setSkill(i, { name: e.target.value })} />
                      {posts.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', maxHeight: 180, overflow: 'auto' }}>
                          {posts.map((p) => {
                            const checked = s.linkedPosts.some((lp) => lp.slug === p.slug);
                            return (
                              <label key={p.slug} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={checked} onChange={() => setSkill(i, {
                                  linkedPosts: checked ? s.linkedPosts.filter((lp) => lp.slug !== p.slug) : [...s.linkedPosts, { slug: p.slug, title: p.title }],
                                })} />
                                {p.title}
                              </label>
                            );
                          })}
                        </div>
                      ) : <p style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No blog posts to link yet.</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {section === 'projects' && (
            <>
              <button className="btn btn-primary" style={{ marginBottom: '0.75rem' }}
                onClick={() => update({ projects: [...resume.projects, { id: newId(), name: '', description: '', category: 'Other', blogSlug: '' }] })}>
                + Add project
              </button>
              {resume.projects.map((p, i) => (
                <div key={p.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{p.name || 'New project'}</strong>
                    <RowControls index={i} count={resume.projects.length} name={p.name || 'project'}
                      onMove={(to) => update({ projects: move(resume.projects, i, to) })}
                      onDelete={() => remove('this project', () => update({ projects: resume.projects.filter((_, j) => j !== i) }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 0.75rem' }}>
                    <div><label style={label}>Name</label><input style={input} value={p.name} onChange={(e) => setProject(i, { name: e.target.value })} /></div>
                    <div>
                      <label style={label}>Category</label>
                      <select style={input} value={p.category} onChange={(e) => setProject(i, { category: e.target.value })}>
                        {PROJECT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={label}>Blog post</label>
                      <select style={input} value={p.blogSlug} onChange={(e) => setProject(i, { blogSlug: e.target.value })}>
                        <option value="">None</option>
                        {posts.map((post) => <option key={post.slug} value={post.slug}>{post.title}</option>)}
                      </select>
                    </div>
                  </div>
                  {(p.post || p.albumId) && (
                    <p className="workout-hint" style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.5rem 0 0' }}>
                      Linked: {p.post ? `📝 “${p.post.title}”` : ''}{p.post && p.albumId ? ' · ' : ''}{p.albumId ? '📷 photo album' : ''}
                      {!p.blogSlug && p.post ? ' (matched by name)' : ''}
                    </p>
                  )}
                  <label style={label}>Description</label>
                  <textarea style={{ ...input, minHeight: 60 }} value={p.description} onChange={(e) => setProject(i, { description: e.target.value })} />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="resume-editor-preview">
          <ResumeView resume={{
            ...resume,
            experience: resume.experience.map((e) => ({ ...e, details: e.details.map((d) => d.trim()).filter(Boolean) })),
          }} />
        </div>
      </div>
    </div>
  );
}
