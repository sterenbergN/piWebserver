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

interface CADProject {
  id: string;
  name: string;
  description: string;
  link: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Automation: '#3b82f6',
  Infrastructure: '#8b5cf6',
  Software: '#10b981',
  Hardware: '#f59e0b',
  Other: '#64748b',
};

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cadProjects, setCadProjects] = useState<CADProject[]>([]);
  const [cadExpanded, setCadExpanded] = useState(false);
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const EMAIL = 'NoahSterenberg@gmail.com';

  useEffect(() => {
    setMounted(true);
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.success) setProjects(d.projects);
    });
    fetch('/api/cad').then(r => r.json()).then(d => {
      if (d.success) setCadProjects(d.projects);
    });
  }, []);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(EMAIL).then(() => {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2500);
    });
  };

  if (!mounted) return null; // Avoid hydration mismatch for dynamic styles

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .hero-gradient {
          background: linear-gradient(-45deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15), rgba(16,185,129,0.15));
          background-size: 400% 400%;
          animation: gradientBG 15s ease infinite;
          border-radius: 24px;
          position: relative;
          overflow: hidden;
        }
        @keyframes gradientBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .hero-gradient::before {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(circle at center, transparent 0%, var(--background) 100%);
          pointer-events: none;
        }
        .premium-card {
          background: var(--card-bg);
          border: 1px solid var(--surface-border);
          border-radius: 16px;
          padding: 2rem;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          position: relative;
          overflow: hidden;
        }
        .premium-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 40px rgba(0,0,0,0.15);
          border-color: rgba(255,255,255,0.2);
        }
        .premium-card::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
          opacity: 0; transition: opacity 0.3s; pointer-events: none;
        }
        .premium-card:hover::after { opacity: 1; }
        
        .skill-badge {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--surface-border);
          padding: 0.5rem 1rem;
          border-radius: 30px;
          font-size: 0.85rem;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: all 0.3s ease;
          cursor: default;
          box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .skill-badge:hover {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
          transform: translateY(-2px);
          box-shadow: 0 8px 12px rgba(0,0,0,0.1);
        }
      `}} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5rem', padding: '2rem 0 5rem' }}>

        {/* Hero Section */}
        <section className="hero-gradient animate-fade-in" style={{ textAlign: 'center', padding: '6rem 2rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h1 style={{ fontSize: 'clamp(3rem, 8vw, 4.5rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '1.5rem', background: 'linear-gradient(to right, var(--foreground), #888)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Noah Sterenberg
            </h1>
            <p style={{ fontSize: '1.25rem', color: 'var(--muted)', maxWidth: '700px', margin: '0 auto 3rem', lineHeight: 1.6, fontWeight: 400 }}>
              Mechanical / Automation Engineer, Maker, and Technology Enthusiast weaving software and hardware into seamless solutions.
            </p>

            {/* CTA Buttons */}
            <div style={{ display: 'flex', gap: '1.25rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '3.5rem' }}>
              <Link href="/gallery" className="btn btn-primary" style={{ padding: '0.8rem 2rem', fontSize: '1.05rem', borderRadius: '30px', fontWeight: 600, boxShadow: '0 10px 25px -5px rgba(59,130,246,0.3)' }}>View Gallery</Link>
              <Link href="/blog" className="btn btn-secondary" style={{ padding: '0.8rem 2rem', fontSize: '1.05rem', borderRadius: '30px', fontWeight: 600, background: 'rgba(255,255,255,0.05)' }}>Read the Blog</Link>
            </div>

            {/* Social / Contact Links */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="https://github.com/sterenbergN/" target="_blank" rel="noreferrer"
                className="btn btn-secondary" style={{ gap: '0.6rem', padding: '0.6rem 1.25rem', borderRadius: '20px', background: 'transparent' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
                GitHub
              </a>
              <a href="https://www.linkedin.com/in/noah-sterenberg" target="_blank" rel="noreferrer"
                className="btn btn-secondary" style={{ gap: '0.6rem', padding: '0.6rem 1.25rem', borderRadius: '20px', background: 'transparent' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                LinkedIn
              </a>
              <button onClick={() => setShowEmailPopup(!showEmailPopup)}
                className="btn btn-secondary" style={{ gap: '0.6rem', alignItems: 'center', display: 'flex', cursor: 'pointer', background: showEmailPopup ? 'rgba(255,255,255,0.1)' : 'transparent', padding: '0.6rem 1.25rem', borderRadius: '20px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                Email Me
              </button>
            </div>

            {showEmailPopup && (
              <div className="glass-panel animate-fade-in" style={{ marginTop: '2.5rem', maxWidth: '380px', margin: '2.5rem auto 0', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', backdropFilter: 'blur(20px)', borderRadius: '20px' }}>
                <div>
                  <h3 style={{ marginBottom: '0.4rem', fontSize: '1.2rem', color: 'var(--foreground)' }}>Contact Me</h3>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>Reach out via email</p>
                </div>
                <div style={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '12px', padding: '1rem', fontFamily: 'monospace', fontSize: '1.05rem', letterSpacing: '0.03em', wordBreak: 'break-all', color: 'var(--foreground)' }}>
                  {EMAIL}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-primary" onClick={handleCopyEmail} style={{ flex: 1, padding: '0.75rem', fontSize: '0.9rem', borderRadius: '12px' }}>
                    {emailCopied ? '✅ Copied' : '📋 Copy'}
                  </button>
                  <a href={`mailto:${EMAIL}`} className="btn btn-secondary" style={{ flex: 1, padding: '0.75rem', fontSize: '0.9rem', textAlign: 'center', borderRadius: '12px' }}>
                    ✉️ Mail App
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Experience & Skills */}
        <section className="grid animate-fade-in" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
          <div className="premium-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
              <div style={{ background: 'var(--accent)', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Experience</h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                <div style={{ position: 'absolute', left: 0, top: '6px', bottom: '-2rem', width: '2px', background: 'linear-gradient(to bottom, var(--accent), transparent)' }}></div>
                <div style={{ position: 'absolute', left: '-4px', top: '6px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)' }}></div>
                <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', marginBottom: '0.2rem' }}>Automation Engineer</h3>
                <p style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>2023 – Present</p>
                <p style={{ fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.5 }}>Designing and implementing automated systems for manufacturing and industrial processes, focusing on efficiency and system integration.</p>
              </div>
              
              <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                <div style={{ position: 'absolute', left: '-4px', top: '6px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--surface-border)' }}></div>
                <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', marginBottom: '0.2rem' }}>Mechanical / Reliability Engineer</h3>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>2018 – 2021</p>
                <p style={{ fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.5 }}>Spearheaded maintenance operations and improved reliability metrics for critical mechanical systems in a high-demand refinery environment.</p>
              </div>
            </div>
          </div>

          <div className="premium-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
              <div style={{ background: 'var(--accent)', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Core Skills</h2>
            </div>
            
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>A multidisciplinary toolset spanning hardware control, software development, and modern web infrastructure.</p>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {['PLC Programming', 'HMI Design', 'SCADA Systems', 'CAD / 3D Printing', 'Python', 'Docker', 'Linux / Raspbian', 'React / Next.js', 'TypeScript'].map(skill => (
                <span key={skill} className="skill-badge">{skill}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Projects */}
        <section className="animate-fade-in">
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Featured Projects</h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.1rem' }}>Highlights from my blog and portfolio.</p>
          </div>
          
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            {projects.map(project => {
              const color = CATEGORY_COLORS[project.category] || CATEGORY_COLORS.Other;
              const card = (
                <div className="premium-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', cursor: project.blogSlug ? 'pointer' : 'default', padding: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.5rem' }}>
                    <h3 style={{ color: 'var(--foreground)', fontSize: '1.25rem', lineHeight: 1.3, margin: 0 }}>{project.name}</h3>
                    <span style={{
                      flexShrink: 0, background: `linear-gradient(135deg, ${color}22, ${color}11)`, color, border: `1px solid ${color}44`,
                      padding: '0.25rem 0.75rem', borderRadius: '30px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>{project.category}</span>
                  </div>
                  <p style={{ fontSize: '0.95rem', color: 'var(--muted)', margin: 0, flex: 1, lineHeight: 1.6 }}>{project.description}</p>
                  {project.blogSlug ? (
                    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
                      Read Post <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    </div>
                  ) : (
                    <div style={{ marginTop: '1rem', height: '20px' }}></div>
                  )}
                </div>
              );

              return project.blogSlug
                ? <Link href={`/blog/${project.blogSlug}`} key={project.id} style={{ display: 'block', height: '100%', textDecoration: 'none' }}>{card}</Link>
                : <div key={project.id}>{card}</div>;
            })}
          </div>
        </section>

        {/* CAD Projects */}
        {cadProjects.length > 0 && (
          <section className="animate-fade-in premium-card" style={{ padding: 0 }}>
            <div style={{ padding: '3rem 3rem 1.5rem', textAlign: 'center' }}>
              <h2 style={{ fontSize: '2.2rem', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>CAD Models & Designs</h2>
              <p style={{ color: 'var(--muted)', fontSize: '1.1rem', margin: 0 }}>View external hosted 3D parts and models.</p>
            </div>
            
            <div style={{
              padding: '1.5rem 3rem 3rem',
              maxHeight: cadExpanded ? '10000px' : '440px',
              overflow: 'hidden',
              transition: 'max-height 0.8s cubic-bezier(0.25, 1, 0.5, 1)',
              position: 'relative'
            }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                {cadProjects.map(cad => (
                  <div key={cad.id} style={{
                    background: 'rgba(255,255,255,0.02)', borderRadius: '16px', padding: '1.5rem',
                    border: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '0.75rem',
                    transition: 'all 0.2s',
                  }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'var(--surface-border)'; }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--foreground)' }}>{cad.name}</h3>
                      {cad.link && (
                        <a href={cad.link} target="_blank" rel="noreferrer" title="View Model" style={{ color: 'var(--accent)', background: 'rgba(59,130,246,0.1)', padding: '0.4rem', borderRadius: '50%', display: 'flex' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                        </a>
                      )}
                    </div>
                    <p style={{ fontSize: '0.9rem', margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>{cad.description}</p>
                  </div>
                ))}
              </div>

              {!cadExpanded && cadProjects.length > 3 && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: '180px',
                  background: 'linear-gradient(to bottom, transparent, var(--card-bg) 70%, var(--card-bg))',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '2.5rem',
                  borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px'
                }}>
                  <button className="btn btn-primary" onClick={() => setCadExpanded(true)} style={{ boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)', padding: '0.8rem 2rem', borderRadius: '30px', fontWeight: 600 }}>
                    Load Complete Catalog
                  </button>
                </div>
              )}
            </div>
            
            {cadExpanded && cadProjects.length > 3 && (
              <div style={{ textAlign: 'center', paddingBottom: '3rem' }}>
                <button className="btn btn-secondary" onClick={() => setCadExpanded(false)} style={{ borderRadius: '30px', padding: '0.6rem 2rem' }}>Collapse View</button>
              </div>
            )}
          </section>
        )}

        {/* Philosophy */}
        <section className="animate-fade-in" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16,185,129,0.1)', color: '#10b981', marginBottom: '1.5rem' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
          </div>
          <h2 style={{ fontSize: '1.8rem', letterSpacing: '-0.02em', marginBottom: '1rem' }}>Self-Hosted Architecture</h2>
          <p style={{ maxWidth: '750px', margin: '0 auto', fontSize: '1.1rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            This entire portfolio, gallery, and blog is dynamically served by a self-hosted Next.js application running on a low-power, high-efficiency Raspberry Pi node in my home lab. It demonstrates a commitment to digital independence, privacy, and full-stack engineering.
          </p>
        </section>

      </div>
    </>
  );
}
