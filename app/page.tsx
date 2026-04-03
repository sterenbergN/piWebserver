'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

interface Project {
  id: string;
  name: string;
  description: string;
  category: string;
  blogSlug: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Automation: '#3182ce',
  Infrastructure: '#6b46c1',
  Software: '#38a169',
  Hardware: '#d97706',
  Other: '#64748b',
};

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const EMAIL = 'NoahSterenberg@gmail.com';

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(EMAIL).then(() => {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2500);
    });
  };

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.success) setProjects(d.projects);
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem', padding: '2rem 0' }}>

      {/* Hero Section */}
      <section className="glass-panel animate-fade-in" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>Noah Sterenberg</h1>
        <p style={{ fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto 2rem' }}>
          Mechanical / Automation Engineer, Maker, and Technology Enthusiast
        </p>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
          <Link href="/gallery" className="btn btn-primary">View Gallery</Link>
          <Link href="/blog" className="btn btn-secondary">Read the Blog</Link>
        </div>

        {/* Social / Contact Links */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="https://github.com/sterenbergN/" target="_blank" rel="noreferrer"
            className="btn btn-secondary" style={{ gap: '0.5rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
            GitHub
          </a>
          <a href="https://www.linkedin.com/in/noah-sterenberg" target="_blank" rel="noreferrer"
            className="btn btn-secondary" style={{ gap: '0.5rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
            LinkedIn
          </a>
          <button onClick={() => setShowEmailPopup(true)}
            className="btn btn-secondary" style={{ gap: '0.5rem', alignItems: 'center', display: 'flex', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
            Email Me
          </button>
        </div>
      </section>

      {/* Experience & Skills */}
      <section className="grid animate-fade-in" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="glass-panel">
          <h2>Experience</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div style={{ borderLeft: '2px solid var(--accent)', paddingLeft: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Automation Engineer</h3>
              <p style={{ color: 'var(--accent-light)', margin: '0.25rem 0', fontSize: '0.9rem' }}>2023 – Present</p>
              <p style={{ fontSize: '0.9rem' }}>Designing and implementing automated systems for manufacturing and industrial processes.</p>
            </div>
            <div style={{ borderLeft: '2px solid var(--surface-border)', paddingLeft: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Mechanical / Reliability Engineer</h3>
              <p style={{ color: 'var(--accent-light)', margin: '0.25rem 0', fontSize: '0.9rem' }}>2018 – 2021</p>
              <p style={{ fontSize: '0.9rem' }}>Maintained and improved mechanical systems in a refinery environment.</p>
            </div>
          </div>
        </div>

        <div className="glass-panel">
          <h2>Core Skills</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.5rem' }}>
            {['PLC Programming', 'HMI Design', 'SCADA Systems', 'CAD', 'Python', 'Docker', 'Linux/Raspbian', 'Next.js', 'TypeScript'].map(skill => (
              <span key={skill} style={{
                background: 'var(--card-bg)', border: '1px solid var(--surface-border)',
                padding: '0.4rem 0.9rem', borderRadius: '20px', fontSize: '0.85rem',
                cursor: 'default', transition: 'all 0.2s ease'
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.color = ''; }}
              >{skill}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Projects */}
      <section className="glass-panel animate-fade-in">
        <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>Featured Projects</h2>
        <p style={{ textAlign: 'center', marginBottom: '2rem' }}>Click a project card to read the full blog post.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
          {projects.map(project => {
            const color = CATEGORY_COLORS[project.category] || CATEGORY_COLORS.Other;
            const card = (
              <div style={{
                background: 'var(--card-bg)', borderRadius: '12px', padding: '1.5rem',
                border: '1px solid var(--surface-border)', transition: 'transform 0.2s, box-shadow 0.2s',
                height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem',
                cursor: project.blogSlug ? 'pointer' : 'default'
              }}
                onMouseEnter={e => { if (project.blogSlug) { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)'; } }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <h3 style={{ color: 'var(--foreground)', fontSize: '1rem', lineHeight: 1.3 }}>{project.name}</h3>
                  <span style={{
                    flexShrink: 0, background: `${color}22`, color, border: `1px solid ${color}44`,
                    padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 600
                  }}>{project.category}</span>
                </div>
                <p style={{ fontSize: '0.88rem', margin: 0, flex: 1 }}>{project.description}</p>
                {project.blogSlug && (
                  <span style={{ color: 'var(--accent-light)', fontSize: '0.85rem', fontWeight: 600 }}>Read Post →</span>
                )}
              </div>
            );

            return project.blogSlug
              ? <Link href={`/blog/${project.blogSlug}`} key={project.id} style={{ display: 'block', height: '100%' }}>{card}</Link>
              : <div key={project.id}>{card}</div>;
          })}
        </div>
      </section>

      {/* Philosophy */}
      <section className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
        <h2>Self-Hosted Architecture</h2>
        <p style={{ maxWidth: '800px', margin: '1rem auto' }}>
          This entire portfolio, gallery, and blog is dynamically served by a self-hosted Next.js application running on a low-power, high-efficiency Raspberry Pi node in my home lab. It demonstrates a commitment to digital independence, privacy, and full-stack engineering.
        </p>
      </section>

      {/* Email popup modal */}
      {showEmailPopup && (
        <div
          onClick={() => setShowEmailPopup(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div
            onClick={e => e.stopPropagation()}
            className="glass-panel animate-fade-in"
            style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
            <div>
              <h3 style={{ marginBottom: '0.4rem' }}>Contact Me</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.65 }}>Reach out via email</p>
            </div>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '0.85rem 1.25rem', fontFamily: 'monospace', fontSize: '1rem', letterSpacing: '0.03em' }}>
              {EMAIL}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button className="btn btn-primary" onClick={handleCopyEmail} style={{ width: '100%', justifyContent: 'center' }}>
                {emailCopied ? '✅ Copied!' : '📋 Copy to Clipboard'}
              </button>
              <a href={`mailto:${EMAIL}`} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', textAlign: 'center' }}>
                ✉️ Open Mail App
              </a>
              <button className="btn btn-secondary" onClick={() => setShowEmailPopup(false)} style={{ width: '100%', justifyContent: 'center' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
