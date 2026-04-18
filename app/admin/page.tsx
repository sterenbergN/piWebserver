'use client';

import { useState, useEffect } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { normalizeBirthdate } from '@/lib/workout/birthdate';

interface SystemStats { platform: string; temp: string; ram: string; storage: string; uptime?: string; cpu?: string; network?: string; }
interface Project { id: string; name: string; description: string; category: string; blogSlug: string; }
interface CADProject { id: string; name: string; description: string; link: string; }
interface WorkoutUser { id: string; username: string; password?: string; birthdate: string; height: string; gender: string; weight: number; }
interface SiteVisit { timestamp: string; path: string; }
interface Skill { id: string; name: string; linkedPosts: { title: string; slug: string; }[]; }
interface ExperienceEntry { id: string; role: string; company: string; period: string; description: string; details: string[]; }

type UploadTab = 'gallery' | 'blog' | 'blog-photo' | 'library' | 'projects' | 'cad' | 'workout-users' | 'skills' | 'experience';

export default function AdminDashboard() {
  const { confirm, popup } = useSitePopup();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<UploadTab>('gallery');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [analytics, setAnalytics] = useState<SiteVisit[] | null>(null);

  // Gallery albums for selector
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  // Blog posts for blog-photo selector  
  const [posts, setPosts] = useState<{ slug: string; title: string }[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', category: '', blogSlug: '' });
  const [projectSaving, setProjectSaving] = useState(false);

  // CAD Projects
  const [cadProjects, setCadProjects] = useState<CADProject[]>([]);
  const [editingCAD, setEditingCAD] = useState<CADProject | null>(null);
  const [addingCAD, setAddingCAD] = useState(false);
  const [newCAD, setNewCAD] = useState({ name: '', description: '', link: '' });
  const [cadSaving, setCadSaving] = useState(false);

  // Workout Users
  const [workoutUsers, setWorkoutUsers] = useState<WorkoutUser[]>([]);
  const [editingWorkoutUser, setEditingWorkoutUser] = useState<WorkoutUser | null>(null);
  const [addingWorkoutUser, setAddingWorkoutUser] = useState(false);
  const [newWorkoutUser, setNewWorkoutUser] = useState<Partial<WorkoutUser>>({ username: '', password: '', birthdate: '', height: '', gender: 'unspecified', weight: 0 });
  const [workoutUserSaving, setWorkoutUserSaving] = useState(false);
  // Skills
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', linkedPostSlugs: [] as string[] });
  const [skillSaving, setSkillSaving] = useState(false);

  // Experience
  const [experience, setExperience] = useState<ExperienceEntry[]>([]);
  const [editingExperience, setEditingExperience] = useState<ExperienceEntry | null>(null);
  const [addingExperience, setAddingExperience] = useState(false);
  const [newExperience, setNewExperience] = useState({ role: '', company: '', period: '', description: '', detailsText: '' });
  const [experienceSaving, setExperienceSaving] = useState(false);

  const fetchStats = () => {
    fetch('/api/stats').then(r => r.json()).then(d => { if (d?.success) setStats(d.data); setStatsLoading(false); }).catch(() => setStatsLoading(false));
    fetch('/api/analytics').then(r => r.json()).then(d => { if (d?.success) setAnalytics(d.visits); }).catch(console.error);
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load albums + posts + projects when relevant tabs become active
  useEffect(() => {
    if (activeTab === 'gallery') {
      fetch('/api/gallery').then(r => r.json()).then(d => { if (d.success) setAlbums(d.albums.map((a: any) => ({ id: a.id, name: a.name }))); });
    }
    if (activeTab === 'blog-photo' || activeTab === 'blog') {
      fetch('/api/blog').then(r => r.json()).then(d => { if (d.success) setPosts(d.posts.map((p: any) => ({ slug: p.slug, title: p.title }))); });
    }
    if (activeTab === 'projects') {
      fetch('/api/projects').then(r => r.json()).then(d => { if (d.success) setProjects(d.projects); });
    }
    if (activeTab === 'cad') {
      fetch('/api/cad').then(r => r.json()).then(d => { if (d.success) setCadProjects(d.projects); });
    }
    if (activeTab === 'workout-users') {
      fetch('/api/workout/users').then(r => r.json()).then(d => { if (d.success) setWorkoutUsers(d.users); });
    }
    if (activeTab === 'skills') {
      fetch('/api/skills').then(r => r.json()).then(d => { if (d.success) setSkills(d.skills); });
      fetch('/api/blog').then(r => r.json()).then(d => { if (d.success) setPosts(d.posts.map((p: any) => ({ slug: p.slug, title: p.title }))); });
    }
    if (activeTab === 'experience') {
      fetch('/api/experience').then(r => r.json()).then(d => { if (d.success) setExperience(d.experience); });
    }
  }, [activeTab]);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(0);
  const [totalUploadCount, setTotalUploadCount] = useState(0);

  const handleLogout = async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.href = '/'; };

  const performUpload = (fd: FormData, onProgress: (p: number) => void): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      });
      xhr.addEventListener('load', () => {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error('Invalid response'));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.open('POST', '/api/upload');
      xhr.send(fd);
    });
  };

  const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setUploadLoading(true);
    setUploadProgress(0);
    setMessage({ text: '', type: '' });
    
    const formData = new FormData(form);
    const type = activeTab === 'blog-photo' ? 'blog-photo' : activeTab;
    
    try {
      if (type === 'gallery') {
        const fileInput = form.querySelector('input[name="image"]') as HTMLInputElement;
        const files = fileInput?.files;
        
        if (files && files.length > 1) {
          // Bulk Mode
          setTotalUploadCount(files.length);
          let successCount = 0;
          
          for (let i = 0; i < files.length; i++) {
            setCurrentUploadIndex(i + 1);
            setUploadProgress(0);
            
            const singleData = new FormData();
            singleData.append('type', 'gallery');
            singleData.append('albumId', formData.get('albumId') as string);
            singleData.append('caption', ''); // Bulk skip individual captions
            singleData.append('image', files[i]);
            
            try {
              const data = await performUpload(singleData, setUploadProgress);
              if (data.success) successCount++;
            } catch (err) {
              console.error(`Upload ${i+1} failed:`, err);
            }
          }
          
          setMessage({ text: `Batch upload complete: ${successCount} of ${files.length} images saved.`, type: 'success' });
          form.reset();
        } else {
          // Single Mode
          setTotalUploadCount(0);
          formData.set('type', type);
          const data = await performUpload(formData, setUploadProgress);
          if (data.success) {
            setMessage({ text: 'Upload successful!', type: 'success' });
            form.reset();
          } else {
            setMessage({ text: data.message || 'Upload failed', type: 'error' });
          }
        }
      } else {
        // Not Gallery - Single File (Blog, etc)
        setTotalUploadCount(0);
        formData.append('type', type);
        const data = await performUpload(formData, setUploadProgress);
        if (data.success) {
          setMessage({ text: 'Upload successful!', type: 'success' });
          form.reset();
        } else {
          setMessage({ text: data.message || 'Upload failed', type: 'error' });
        }
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', type: 'error' });
    } finally {
      setUploadLoading(false);
      setUploadProgress(0);
      setTotalUploadCount(0);
      setCurrentUploadIndex(0);
    }
  };

  const handleAddProject = async () => {
    if (!newProject.name) return;
    setProjectSaving(true);
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProject) });
    const data = await res.json();
    if (data.success) { setProjects([...projects, data.project]); setNewProject({ name: '', description: '', category: '', blogSlug: '' }); setAddingProject(false); }
    setProjectSaving(false);
  };

  const handleUpdateProject = async () => {
    if (!editingProject) return;
    setProjectSaving(true);
    const res = await fetch('/api/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingProject) });
    const data = await res.json();
    if (data.success) { setProjects(projects.map(p => p.id === editingProject.id ? editingProject : p)); setEditingProject(null); }
    setProjectSaving(false);
  };

  const handleDeleteProject = async (id: string) => {
    if (!(await confirm({ title: 'Delete Project', message: 'Delete this project?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setProjects(projects.filter(p => p.id !== id));
  };

  const handleAddCAD = async () => {
    if (!newCAD.name) return;
    setCadSaving(true);
    const res = await fetch('/api/cad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCAD) });
    const data = await res.json();
    if (data.success) { setCadProjects([...cadProjects, data.project]); setNewCAD({ name: '', description: '', link: '' }); setAddingCAD(false); }
    setCadSaving(false);
  };

  const handleUpdateCAD = async () => {
    if (!editingCAD) return;
    setCadSaving(true);
    const res = await fetch('/api/cad', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingCAD) });
    const data = await res.json();
    if (data.success) { setCadProjects(cadProjects.map(p => p.id === editingCAD.id ? editingCAD : p)); setEditingCAD(null); }
    setCadSaving(false);
  };

  const handleDeleteCAD = async (id: string) => {
    if (!(await confirm({ title: 'Delete CAD Project', message: 'Delete this CAD project?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/cad', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setCadProjects(cadProjects.filter(p => p.id !== id));
  };

  const handleAddWorkoutUser = async () => {
    if (!newWorkoutUser.username || !newWorkoutUser.password) return;
    setWorkoutUserSaving(true);
    const res = await fetch('/api/workout/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newWorkoutUser) });
    const data = await res.json();
    if (data.success) { setWorkoutUsers([...workoutUsers, data.user]); setNewWorkoutUser({ username: '', password: '', birthdate: '', height: '', gender: 'unspecified', weight: 0 }); setAddingWorkoutUser(false); }
    setWorkoutUserSaving(false);
  };

  const handleUpdateWorkoutUser = async () => {
    if (!editingWorkoutUser) return;
    setWorkoutUserSaving(true);
    const res = await fetch('/api/workout/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingWorkoutUser) });
    const data = await res.json();
    if (data.success) { setWorkoutUsers(workoutUsers.map(u => u.id === editingWorkoutUser.id ? data.user : u)); setEditingWorkoutUser(null); }
    setWorkoutUserSaving(false);
  };

  const handleDeleteWorkoutUser = async (id: string) => {
    if (!(await confirm({ title: 'Delete Workout User', message: 'Delete this workout user?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/workout/users?id=' + id, { method: 'DELETE' });
    setWorkoutUsers(workoutUsers.filter(u => u.id !== id));
  };

  const handleAddSkill = async () => {
    if (!newSkill.name) return;
    setSkillSaving(true);
    const linkedPosts = newSkill.linkedPostSlugs.map(slug => {
      const p = posts.find(p => p.slug === slug);
      return { title: p?.title || slug, slug };
    });
    const res = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSkill.name, linkedPosts }) });
    const data = await res.json();
    if (data.success) { setSkills([...skills, data.skill]); setNewSkill({ name: '', linkedPostSlugs: [] }); setAddingSkill(false); }
    setSkillSaving(false);
  };

  const handleUpdateSkill = async () => {
    if (!editingSkill) return;
    setSkillSaving(true);
    const res = await fetch('/api/skills', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingSkill) });
    const data = await res.json();
    if (data.success) { setSkills(skills.map(s => s.id === editingSkill.id ? editingSkill : s)); setEditingSkill(null); }
    setSkillSaving(false);
  };

  const handleDeleteSkill = async (id: string) => {
    if (!(await confirm({ title: 'Delete Skill', message: 'Delete this skill?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setSkills(skills.filter(s => s.id !== id));
  };

  const handleAddExperience = async () => {
    if (!newExperience.role || !newExperience.company) return;
    setExperienceSaving(true);
    const details = newExperience.detailsText.split('\n').filter(d => d.trim());
    const res = await fetch('/api/experience', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newExperience, details }) });
    const data = await res.json();
    if (data.success) { setExperience([...experience, data.entry]); setNewExperience({ role: '', company: '', period: '', description: '', detailsText: '' }); setAddingExperience(false); }
    setExperienceSaving(false);
  };

  const handleUpdateExperience = async () => {
    if (!editingExperience) return;
    setExperienceSaving(true);
    const res = await fetch('/api/experience', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingExperience) });
    const data = await res.json();
    if (data.success) { setExperience(experience.map(e => e.id === editingExperience.id ? editingExperience : e)); setEditingExperience(null); }
    setExperienceSaving(false);
  };

  const handleDeleteExperience = async (id: string) => {
    if (!(await confirm({ title: 'Delete Experience', message: 'Delete this experience entry?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch('/api/experience', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setExperience(experience.filter(e => e.id !== id));
  };

  const msgStyle = (type: string) => ({
    padding: '1rem', marginBottom: '1.5rem', borderRadius: '8px',
    background: type === 'success' ? 'rgba(72, 187, 120, 0.1)' : 'rgba(245, 101, 101, 0.1)',
    color: type === 'success' ? '#68d391' : '#fc8181',
    border: `1px solid ${type === 'success' ? '#68d391' : '#fc8181'}`
  });

  const tabs: { id: UploadTab; label: string }[] = [
    { id: 'gallery', label: '📷 Gallery' },
    { id: 'blog', label: '📝 Blog Post' },
    { id: 'blog-photo', label: '🖼️ Blog Photos' },
    { id: 'library', label: '📁 Library PDF' },
    { id: 'projects', label: '🔧 Projects' },
    { id: 'cad', label: '📐 CAD Projects' },
    { id: 'skills', label: '🧠 Skills' },
    { id: 'experience', label: '⌛ Experience' },
    { id: 'workout-users', label: '🏋️ Workout Users' },
  ];

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1>Admin Dashboard</h1>
        <button className="btn btn-secondary" onClick={handleLogout}>Secure Logout</button>
      </div>

      {/* System Vitals */}
      <div style={{ marginBottom: '4rem' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>System Node Vitals</h2>
        {statsLoading && !stats ? <p>Connecting...</p>
          : stats ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              {[
                { label: 'Temp', value: stats.temp },
                { label: 'Memory', value: stats.ram.split('/')[0].trim(), sub: `/ ${stats.ram.split('/')[1]?.trim()}` },
                { label: 'Storage', value: stats.storage.split('(')[0].trim() },
                ...(stats.cpu !== undefined ? [{ label: 'CPU Load', value: `${stats.cpu}%` }] : []),
                ...(stats.uptime ? [{ label: 'Uptime', value: '', sub: stats.uptime }] : []),
                ...(stats.network ? [{ label: 'Network', value: stats.network.split('|')[0]?.trim() || '', sub: stats.network.split('|')[1]?.trim() || '' }] : []),
              ].map(tile => (
                <div key={tile.label} className="glass-panel" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                  <h4 style={{ color: 'var(--accent-light)', marginBottom: '0.5rem', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tile.label}</h4>
                  <p style={{ fontSize: tile.value ? '1.6rem' : '0.9rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--foreground)' }}>{tile.value || tile.sub}</p>
                  {tile.value && tile.sub && <p style={{ fontSize: '0.75rem', opacity: 0.6, margin: '0.25rem 0 0' }}>{tile.sub}</p>}
                </div>
              ))}
            </div>
          ) : <p>Failed to load stats.</p>}
      </div>

      {/* Site Analytics */}
      <div style={{ marginBottom: '4rem' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>Site Visits (Page Views)</h2>
        {!analytics ? <p>Loading analytics...</p> : (
          (() => {
            const now = Date.now();
            const counts = {
              day: analytics.filter(v => now - new Date(v.timestamp).getTime() < 86400000).length,
              week: analytics.filter(v => now - new Date(v.timestamp).getTime() < 86400000 * 7).length,
              month: analytics.filter(v => now - new Date(v.timestamp).getTime() < 86400000 * 30).length,
              total: analytics.length
            };
            return (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                {[
                  { label: 'Last 24 Hours', value: counts.day },
                  { label: 'Last 7 Days', value: counts.week },
                  { label: 'Last 30 Days', value: counts.month },
                  { label: 'All Time', value: counts.total }
                ].map(tile => (
                  <div key={tile.label} className="glass-panel" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                    <h4 style={{ color: 'var(--accent-light)', marginBottom: '0.5rem', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tile.label}</h4>
                    <p style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--foreground)' }}>{tile.value}</p>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>

      {/* Content Manager */}
      <div style={{ background: 'var(--surface-glass)', borderRadius: '16px', border: '1px solid var(--surface-border)', padding: '2rem' }}>
        <h2 style={{ marginBottom: '2rem' }}>Content Manager</h2>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} className={activeTab === t.id ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setActiveTab(t.id); setMessage({ text: '', type: '' }); }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Projects Tab */}
        {activeTab === 'projects' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3>Manage Projects</h3>
              <button className="btn btn-primary" onClick={() => setAddingProject(!addingProject)}>
                {addingProject ? 'Cancel' : '+ Add Project'}
              </button>
            </div>

            {addingProject && (
              <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4>New Project</h4>
                <input placeholder="Project Name *" value={newProject.name} onChange={e => setNewProject({ ...newProject, name: e.target.value })} />
                <textarea placeholder="Description" value={newProject.description} onChange={e => setNewProject({ ...newProject, description: e.target.value })} rows={2} />
                <input placeholder="Category (e.g. Automation, Infrastructure)" value={newProject.category} onChange={e => setNewProject({ ...newProject, category: e.target.value })} />
                <input placeholder="Blog Slug (leave blank if no post)" value={newProject.blogSlug} onChange={e => setNewProject({ ...newProject, blogSlug: e.target.value })} />
                <button className="btn btn-primary" onClick={handleAddProject} disabled={projectSaving} style={{ alignSelf: 'flex-start' }}>{projectSaving ? 'Saving...' : 'Add Project'}</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {projects.map(p => (
                <div key={p.id}>
                  {editingProject?.id === p.id ? (
                    <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <input value={editingProject.name} onChange={e => setEditingProject({ ...editingProject, name: e.target.value })} placeholder="Name" />
                      <textarea value={editingProject.description} onChange={e => setEditingProject({ ...editingProject, description: e.target.value })} rows={2} placeholder="Description" />
                      <input value={editingProject.category} onChange={e => setEditingProject({ ...editingProject, category: e.target.value })} placeholder="Category" />
                      <input value={editingProject.blogSlug} onChange={e => setEditingProject({ ...editingProject, blogSlug: e.target.value })} placeholder="Blog Slug" />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleUpdateProject} disabled={projectSaving}>{projectSaving ? 'Saving...' : 'Save'}</button>
                        <button className="btn btn-secondary" onClick={() => setEditingProject(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <strong>{p.name}</strong>
                        {p.category && <span style={{ marginLeft: '0.75rem', fontSize: '0.78rem', opacity: 0.6 }}>[{p.category}]</span>}
                        {p.blogSlug && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: 'var(--accent-light)' }}>→ /blog/{p.blogSlug}</span>}
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', opacity: 0.7 }}>{p.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }} onClick={() => setEditingProject(p)}>✏️</button>
                        <button style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleDeleteProject(p.id)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {projects.length === 0 && <p>No projects yet. Add one above.</p>}
            </div>
          </div>
        ) : activeTab === 'cad' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3>Manage CAD Projects</h3>
              <button className="btn btn-primary" onClick={() => setAddingCAD(!addingCAD)}>
                {addingCAD ? 'Cancel' : '+ Add CAD Project'}
              </button>
            </div>

            {addingCAD && (
              <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4>New CAD Project</h4>
                <input placeholder="CAD Project Name *" value={newCAD.name} onChange={e => setNewCAD({ ...newCAD, name: e.target.value })} />
                <textarea placeholder="Description" value={newCAD.description} onChange={e => setNewCAD({ ...newCAD, description: e.target.value })} rows={2} />
                <input placeholder="External Model/Part Link (e.g. Onshape URL)" value={newCAD.link} onChange={e => setNewCAD({ ...newCAD, link: e.target.value })} />
                <button className="btn btn-primary" onClick={handleAddCAD} disabled={cadSaving} style={{ alignSelf: 'flex-start' }}>{cadSaving ? 'Saving...' : 'Add CAD Project'}</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cadProjects.map(p => (
                <div key={p.id}>
                  {editingCAD?.id === p.id ? (
                    <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <input value={editingCAD.name} onChange={e => setEditingCAD({ ...editingCAD, name: e.target.value })} placeholder="Name" />
                      <textarea value={editingCAD.description} onChange={e => setEditingCAD({ ...editingCAD, description: e.target.value })} rows={2} placeholder="Description" />
                      <input value={editingCAD.link} onChange={e => setEditingCAD({ ...editingCAD, link: e.target.value })} placeholder="External Link" />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleUpdateCAD} disabled={cadSaving}>{cadSaving ? 'Saving...' : 'Save'}</button>
                        <button className="btn btn-secondary" onClick={() => setEditingCAD(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <strong>{p.name}</strong>
                        {p.link && <a href={p.link} target="_blank" rel="noreferrer" style={{ marginLeft: '0.75rem', fontSize: '0.78rem', color: 'var(--accent-light)' }}>→ View Model</a>}
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', opacity: 0.7 }}>{p.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }} onClick={() => setEditingCAD(p)}>✏️</button>
                        <button style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleDeleteCAD(p.id)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {cadProjects.length === 0 && <p>No CAD projects yet. Add one above.</p>}
            </div>
          </div>
        ) : activeTab === 'workout-users' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3>Manage Workout Users</h3>
              <button className="btn btn-primary" onClick={() => setAddingWorkoutUser(!addingWorkoutUser)}>
                {addingWorkoutUser ? 'Cancel' : '+ Add User'}
              </button>
            </div>

            {addingWorkoutUser && (
              <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4>New Workout User</h4>
                <input placeholder="Username *" value={newWorkoutUser.username} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, username: e.target.value })} />
                <input type="password" placeholder="Password *" value={newWorkoutUser.password} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, password: e.target.value })} />
                <input placeholder="Birthdate (MM-DD-YYYY)" value={newWorkoutUser.birthdate} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, birthdate: e.target.value })} />
                <input placeholder="Height (e.g. 5'10 or 70 inches)" value={newWorkoutUser.height} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, height: e.target.value })} />
                <select value={newWorkoutUser.gender} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, gender: e.target.value })} style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                  <option value="unspecified">Unspecified gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <input type="number" placeholder="Current Weight (lbs)" value={newWorkoutUser.weight || ''} onChange={e => setNewWorkoutUser({ ...newWorkoutUser, weight: parseFloat(e.target.value) || 0 })} />
                <button className="btn btn-primary" onClick={handleAddWorkoutUser} disabled={workoutUserSaving} style={{ alignSelf: 'flex-start' }}>{workoutUserSaving ? 'Saving...' : 'Add User'}</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {workoutUsers.map(u => (
                <div key={u.id}>
                  {editingWorkoutUser?.id === u.id ? (
                    <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <input value={editingWorkoutUser.username} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, username: e.target.value })} placeholder="Username" />
                      <input type="password" placeholder="New Password (optional)" value={editingWorkoutUser.password || ''} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, password: e.target.value })} />
                      <input value={editingWorkoutUser.birthdate} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, birthdate: e.target.value })} placeholder="Birthdate (MM-DD-YYYY)" />
                      <input value={editingWorkoutUser.height} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, height: e.target.value })} placeholder="Height" />
                      <select value={editingWorkoutUser.gender} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, gender: e.target.value })} style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                        <option value="unspecified">Unspecified gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                      <input type="number" value={editingWorkoutUser.weight || ''} onChange={e => setEditingWorkoutUser({ ...editingWorkoutUser, weight: parseFloat(e.target.value) || 0 })} placeholder="Weight" />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleUpdateWorkoutUser} disabled={workoutUserSaving}>{workoutUserSaving ? 'Saving...' : 'Save'}</button>
                        <button className="btn btn-secondary" onClick={() => setEditingWorkoutUser(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <strong>{u.username}</strong>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', opacity: 0.7 }}>
                          {u.gender !== 'unspecified' ? u.gender : ''} | {u.weight ? `${u.weight} lbs` : ''} | {u.height ? u.height : ''} | {u.birthdate ? `DOB: ${normalizeBirthdate(u.birthdate)}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }} onClick={() => setEditingWorkoutUser(u)}>✏️</button>
                        <button style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleDeleteWorkoutUser(u.id)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {workoutUsers.length === 0 && <p>No workout users yet.</p>}
            </div>
          </div>
        ) : activeTab === 'skills' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3>Manage Skills</h3>
              <button className="btn btn-primary" onClick={() => setAddingSkill(!addingSkill)}>{addingSkill ? 'Cancel' : '+ Add Skill'}</button>
            </div>
            {addingSkill && (
              <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4>New Skill</h4>
                <input placeholder="Skill Name (e.g. Python) *" value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0 0' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>Link Blog Posts <span style={{ opacity: 0.5 }}>(optional — select multiple or none)</span></p>
                  {newSkill.linkedPostSlugs.length > 0 && <button type="button" onClick={() => setNewSkill({ ...newSkill, linkedPostSlugs: [] })} style={{ fontSize: '0.75rem', background: 'rgba(235,77,75,0.15)', color: '#eb4d4b', border: '1px solid rgba(235,77,75,0.3)', borderRadius: '6px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}>Clear All</button>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '200px', overflowY: 'auto', padding: '0.5rem', background: 'var(--input-bg)', borderRadius: '8px' }}>
                  {posts.map(p => (
                    <label key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', padding: '0.4rem 0.6rem', borderRadius: '6px', background: newSkill.linkedPostSlugs.includes(p.slug) ? 'rgba(107,70,193,0.15)' : 'transparent', border: newSkill.linkedPostSlugs.includes(p.slug) ? '1px solid var(--accent)' : '1px solid transparent', transition: 'all 0.15s' }}>
                      <input type="checkbox" checked={newSkill.linkedPostSlugs.includes(p.slug)} onChange={e => {
                        if (e.target.checked) setNewSkill({ ...newSkill, linkedPostSlugs: [...newSkill.linkedPostSlugs, p.slug] });
                        else setNewSkill({ ...newSkill, linkedPostSlugs: newSkill.linkedPostSlugs.filter(s => s !== p.slug) });
                      }} style={{ accentColor: 'var(--accent)', width: '16px', height: '16px', cursor: 'pointer' }} />
                      {p.title}
                    </label>
                  ))}
                  {posts.length === 0 && <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>No blog posts found.</p>}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', opacity: 0.6 }}>{newSkill.linkedPostSlugs.length} post{newSkill.linkedPostSlugs.length !== 1 ? 's' : ''} selected</div>
                <button className="btn btn-primary" onClick={handleAddSkill} disabled={skillSaving} style={{ alignSelf: 'flex-start' }}>{skillSaving ? 'Saving...' : 'Add Skill'}</button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {skills.map(s => (
                <div key={s.id}>
                  {editingSkill?.id === s.id ? (
                    <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <input value={editingSkill.name} onChange={e => setEditingSkill({ ...editingSkill, name: e.target.value })} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0 0' }}>
                        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>Linked Posts <span style={{ opacity: 0.5 }}>(optional)</span></p>
                        {editingSkill.linkedPosts.length > 0 && <button type="button" onClick={() => setEditingSkill({ ...editingSkill, linkedPosts: [] })} style={{ fontSize: '0.75rem', background: 'rgba(235,77,75,0.15)', color: '#eb4d4b', border: '1px solid rgba(235,77,75,0.3)', borderRadius: '6px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}>Clear All</button>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '200px', overflowY: 'auto', padding: '0.5rem', background: 'var(--input-bg)', borderRadius: '8px' }}>
                        {posts.map(p => (
                          <label key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', padding: '0.4rem 0.6rem', borderRadius: '6px', background: editingSkill.linkedPosts.some(lp => lp.slug === p.slug) ? 'rgba(107,70,193,0.15)' : 'transparent', border: editingSkill.linkedPosts.some(lp => lp.slug === p.slug) ? '1px solid var(--accent)' : '1px solid transparent', transition: 'all 0.15s' }}>
                            <input type="checkbox" checked={editingSkill.linkedPosts.some(lp => lp.slug === p.slug)} onChange={e => {
                              if (e.target.checked) setEditingSkill({ ...editingSkill, linkedPosts: [...editingSkill.linkedPosts, { title: p.title, slug: p.slug }] });
                              else setEditingSkill({ ...editingSkill, linkedPosts: editingSkill.linkedPosts.filter(lp => lp.slug !== p.slug) });
                            }} style={{ accentColor: 'var(--accent)', width: '16px', height: '16px', cursor: 'pointer' }} />
                            {p.title}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', opacity: 0.6 }}>{editingSkill.linkedPosts.length} post{editingSkill.linkedPosts.length !== 1 ? 's' : ''} selected</div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleUpdateSkill} disabled={skillSaving}>{skillSaving ? 'Saving...' : 'Save'}</button>
                        <button className="btn btn-secondary" onClick={() => setEditingSkill(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: '1.1rem' }}>{s.name}</strong>
                        {s.linkedPosts?.length > 0 && (
                          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {s.linkedPosts.map(lp => <span key={lp.slug} style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{lp.title}</span>)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem' }} onClick={() => setEditingSkill(s)}>✏️</button>
                        <button style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer' }} onClick={() => handleDeleteSkill(s.id)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {skills.length === 0 && <p>No skills added yet.</p>}
            </div>
          </div>
        ) : activeTab === 'experience' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3>Manage Experience</h3>
              <button className="btn btn-primary" onClick={() => setAddingExperience(!addingExperience)}>{addingExperience ? 'Cancel' : '+ Add Entry'}</button>
            </div>
            {addingExperience && (
              <div className="glass-panel animate-fade-in" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4>New Entry</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <input placeholder="Role (e.g. Automation Engineer) *" value={newExperience.role} onChange={e => setNewExperience({ ...newExperience, role: e.target.value })} />
                  <input placeholder="Company *" value={newExperience.company} onChange={e => setNewExperience({ ...newExperience, company: e.target.value })} />
                </div>
                <input placeholder="Period (e.g. 2023 – Present) *" value={newExperience.period} onChange={e => setNewExperience({ ...newExperience, period: e.target.value })} />
                <textarea placeholder="Brief Summary Description" value={newExperience.description} onChange={e => setNewExperience({ ...newExperience, description: e.target.value })} rows={2} />
                <textarea placeholder="Detail Bullets (one per line)" value={newExperience.detailsText} onChange={e => setNewExperience({ ...newExperience, detailsText: e.target.value })} rows={4} />
                <button className="btn btn-primary" onClick={handleAddExperience} disabled={experienceSaving} style={{ alignSelf: 'flex-start' }}>{experienceSaving ? 'Saving...' : 'Add Entry'}</button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {experience.map(e => (
                <div key={e.id}>
                  {editingExperience?.id === e.id ? (
                    <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <input value={editingExperience.role} onChange={val => setEditingExperience({ ...editingExperience, role: val.target.value })} />
                        <input value={editingExperience.company} onChange={val => setEditingExperience({ ...editingExperience, company: val.target.value })} />
                      </div>
                      <input value={editingExperience.period} onChange={val => setEditingExperience({ ...editingExperience, period: val.target.value })} />
                      <textarea value={editingExperience.description} onChange={val => setEditingExperience({ ...editingExperience, description: val.target.value })} rows={2} />
                      <textarea value={editingExperience.details.join('\n')} onChange={val => setEditingExperience({ ...editingExperience, details: val.target.value.split('\n') })} rows={4} />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleUpdateExperience} disabled={experienceSaving}>{experienceSaving ? 'Saving...' : 'Save'}</button>
                        <button className="btn btn-secondary" onClick={() => setEditingExperience(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: '1.1rem' }}>{e.role} @ {e.company}</strong>
                        <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{e.period}</div>
                        <p style={{ fontSize: '0.85rem', margin: '0.5rem 0 0', opacity: 0.8 }}>{e.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem' }} onClick={() => setEditingExperience(e)}>✏️</button>
                        <button style={{ background: '#eb4d4b', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer' }} onClick={() => handleDeleteExperience(e.id)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {experience.length === 0 && <p>No experience entries added yet.</p>}
            </div>
          </div>
        ) : (
          /* Upload forms */
          <div className="glass-panel" style={{ padding: '2rem' }}>
            {message.text && <div style={msgStyle(message.type)}>{message.text}</div>}
            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* Gallery */}
              {activeTab === 'gallery' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                      onClick={async () => {
                        if (!(await confirm({
                          title: 'Repair Gallery Index',
                          message: 'Re-scan disk and repair gallery entries? This will add any orphaned files to General.',
                          confirmLabel: 'Run Repair'
                        }))) return;
                        setUploadLoading(true);
                        try {
                          const res = await fetch('/api/gallery/repair', { method: 'POST' });
                          const data = await res.json();
                          if (data.success) {
                            setMessage({ text: `Repair complete! Added ${data.added} missing images.`, type: 'success' });
                            // Reload albums to show changes
                            const galRes = await fetch('/api/gallery');
                            const galData = await galRes.json();
                            if (galData.success) setAlbums(galData.albums);
                          } else {
                            setMessage({ text: data.message || 'Repair failed.', type: 'error' });
                          }
                        } catch {
                          setMessage({ text: 'Network error during repair.', type: 'error' });
                        } finally {
                          setUploadLoading(false);
                        }
                      }}
                      disabled={uploadLoading}
                    >
                      🛠️ Repair & Re-scan
                    </button>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Album</label>
                    <select name="albumId" style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                      {albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      {albums.length === 0 && <option value="general">General</option>}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Caption (Optional)</label>
                    <input type="text" name="caption" disabled={uploadLoading} placeholder="A beautiful sunset..." />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Images (Max 25MB each)</label>
                    <input type="file" name="image" accept="image/*" multiple required disabled={uploadLoading} style={{ background: 'transparent', padding: '0.5rem 0', border: 'none' }} />
                  </div>
                </>
              )}

              {/* Blog post */}
              {activeTab === 'blog' && (
                <>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Title</label><input type="text" name="title" required disabled={uploadLoading} placeholder="My Blog Post" /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Description</label><input type="text" name="description" required disabled={uploadLoading} placeholder="A short summary..." /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Category</label><input type="text" name="category" required disabled={uploadLoading} placeholder="e.g. Infrastructure, Software" /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Cover Image</label><input type="file" name="image" accept="image/*" required disabled={uploadLoading} style={{ background: 'transparent', padding: '0.5rem 0', border: 'none' }} /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Markdown File (.md)</label><input type="file" name="markdown" accept=".md" required disabled={uploadLoading} style={{ background: 'transparent', padding: '0.5rem 0', border: 'none' }} /></div>
                </>
              )}

              {/* Blog extra photos */}
              {activeTab === 'blog-photo' && (
                <>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Blog Post</label>
                    <select name="slug" required style={{ background: 'var(--input-bg)', color: 'var(--foreground)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                      {posts.map(p => <option key={p.slug} value={p.slug}>{p.title}</option>)}
                      {posts.length === 0 && <option value="">No posts found</option>}
                    </select>
                  </div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Photo Description</label><input type="text" name="description" disabled={uploadLoading} placeholder="Description of this photo..." /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Photo (Max 25MB)</label><input type="file" name="image" accept="image/*" required disabled={uploadLoading} style={{ background: 'transparent', padding: '0.5rem 0', border: 'none' }} /></div>
                </>
              )}

              {/* Library */}
              {activeTab === 'library' && (
                <>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Document Name</label><input type="text" name="name" required disabled={uploadLoading} placeholder="System Manual V2" /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>Category (Optional)</label><input type="text" name="category" disabled={uploadLoading} placeholder="Hardware / Specifications" /></div>
                  <div><label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>PDF Document (Max 30MB)</label><input type="file" name="file" accept=".pdf" required disabled={uploadLoading} style={{ background: 'transparent', padding: '0.5rem 0', border: 'none' }} /></div>
                </>
              )}

              {uploadLoading && (
                <div className="animate-fade-in" style={{ marginTop: '0.5rem', width: '100%', maxWidth: '400px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--muted)' }}>
                      {totalUploadCount > 0 ? `Uploading file ${currentUploadIndex} of ${totalUploadCount}...` : 'Uploading...'}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--accent-light)' }}>{uploadProgress}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--surface-border)' }}>
                    <div style={{ 
                      width: `${uploadProgress}%`, 
                      height: '100%', 
                      background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-light) 100%)',
                      transition: 'width 0.2s ease-out',
                      boxShadow: '0 0 10px var(--accent)'
                    }} />
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={uploadLoading} style={{ alignSelf: 'flex-start' }}>
                {uploadLoading ? 'Processing...' : `Upload`}
              </button>
            </form>
          </div>
        )}
      </div>
      {popup}
    </div>
  );
}
