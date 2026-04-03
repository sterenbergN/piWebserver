'use client';

import { useState, useEffect } from 'react';

interface SystemStats { platform: string; temp: string; ram: string; storage: string; uptime?: string; cpu?: string; }
interface Project { id: string; name: string; description: string; category: string; blogSlug: string; }
interface CADProject { id: string; name: string; description: string; link: string; }

type UploadTab = 'gallery' | 'blog' | 'blog-photo' | 'library' | 'projects' | 'cad';

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<UploadTab>('gallery');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

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

  const fetchStats = () => {
    fetch('/api/stats').then(r => r.json()).then(d => { if (d?.success) setStats(d.data); setStatsLoading(false); }).catch(() => setStatsLoading(false));
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
    if (activeTab === 'blog-photo') {
      fetch('/api/blog').then(r => r.json()).then(d => { if (d.success) setPosts(d.posts.map((p: any) => ({ slug: p.slug, title: p.title }))); });
    }
    if (activeTab === 'projects') {
      fetch('/api/projects').then(r => r.json()).then(d => { if (d.success) setProjects(d.projects); });
    }
    if (activeTab === 'cad') {
      fetch('/api/cad').then(r => r.json()).then(d => { if (d.success) setCadProjects(d.projects); });
    }
  }, [activeTab]);

  const [uploadProgress, setUploadProgress] = useState(0);

  const handleLogout = async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.href = '/'; };

  const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploadLoading(true);
    setUploadProgress(0);
    setMessage({ text: '', type: '' });
    const formData = new FormData(e.currentTarget);
    formData.append('type', activeTab === 'blog-photo' ? 'blog-photo' : activeTab);
    
    // Using XMLHttpRequest instead of fetch to track upload progress
    const xhr = new XMLHttpRequest();
    
    const uploadPromise = new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
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
      xhr.send(formData);
    });

    try {
      const data: any = await uploadPromise;
      if (data.success) {
        setMessage({ text: 'Upload successful!', type: 'success' });
        (e.target as HTMLFormElement).reset();
      } else {
        setMessage({ text: data.message || 'Upload failed', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', type: 'error' });
    } finally {
      setUploadLoading(false);
      setUploadProgress(0);
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
    if (!confirm('Delete this project?')) return;
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
    if (!confirm('Delete this CAD project?')) return;
    await fetch('/api/cad', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setCadProjects(cadProjects.filter(p => p.id !== id));
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
        ) : (
          /* Upload forms */
          <div className="glass-panel" style={{ padding: '2rem' }}>
            {message.text && <div style={msgStyle(message.type)}>{message.text}</div>}
            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* Gallery */}
              {activeTab === 'gallery' && (
                <>
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
                    <span style={{ color: 'var(--muted)' }}>Uploading...</span>
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
    </div>
  );
}
