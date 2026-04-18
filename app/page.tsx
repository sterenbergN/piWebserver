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

interface Skill {
  id: string;
  name: string;
  linkedPosts: { title: string; slug: string; }[];
}

interface ExperienceEntry {
  id: string;
  role: string;
  company: string;
  period: string;
  description: string;
  details: string[];
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
  const [skills, setSkills] = useState<Skill[]>([]);
  const [experience, setExperience] = useState<ExperienceEntry[]>([]);
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [isExpExpanded, setIsExpExpanded] = useState(false);
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
    fetch('/api/skills').then(r => r.json()).then(d => {
      if (d.success) setSkills(d.skills);
    });
    fetch('/api/experience').then(r => r.json()).then(d => {
      if (d.success) setExperience(d.experience);
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
        .premium-card.no-clip {
          overflow: visible;
        }
        .premium-card.no-clip::after {
          display: none;
        }
        .premium-card.exp-card {
          transition: all 0.5s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .premium-card.exp-card:hover {
          transform: none;
        }
        
        .skill-wrapper {
          position: relative;
          display: inline-flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .skill-wrapper.active {
          z-index: 100;
        }
        .skill-badge {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--surface-border);
          padding: 0.5rem 1rem;
          border-radius: 30px;
          font-size: 0.85rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: default;
          box-shadow: 0 4px 6px rgba(0,0,0,0.05);
          user-select: none;
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
        }
        .skill-badge:hover {
          background: rgba(255,255,255,0.03);
          transform: none;
          box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .skill-badge.has-posts { 
          cursor: pointer; 
        }
        .skill-badge.has-posts:hover {
          background: rgba(255,255,255,0.08);
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0,0,0,0.1);
        }
        .skill-badge.has-posts::after {
          content: '▾';
          margin-left: 0.4rem;
          font-size: 0.7rem;
          opacity: 0.5;
          transition: transform 0.3s;
        }
        .skill-wrapper.active .skill-badge {
          opacity: 0;
          pointer-events: none;
        }
        .skill-popover {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          max-height: 38px;
          transform: translate(-50%, -50%);
          background: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 30px;
          opacity: 0;
          pointer-events: none;
          transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
          z-index: 100;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        .skill-wrapper.active .skill-popover {
          opacity: 1;
          pointer-events: auto;
          width: 250px;
          max-height: 400px;
          border-radius: 16px;
          background: rgba(18, 18, 22, 0.98);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: 0 20px 40px rgba(0,0,0,0.6), 0 0 0 1px var(--accent);
          border-color: var(--accent);
        }
        .skill-popover-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 1rem;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 600;
          color: white;
          background: var(--accent);
          flex-shrink: 0;
          height: 38px;
          box-sizing: border-box;
          border-bottom: 1px solid transparent;
        }
        .skill-wrapper.active .skill-popover-header {
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .skill-popover-content {
          padding: 0.75rem 1rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          opacity: 0;
          transform: translateY(-10px);
          transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .skill-wrapper.active .skill-popover-content {
          opacity: 1;
          transform: translateY(0);
          transition-delay: 0.15s;
        }
        .skill-popover-title {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          padding: 0.2rem 0.5rem;
          font-weight: 600;
        }
        .skill-post-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.55rem 0.75rem;
          border-radius: 10px;
          text-decoration: none;
          color: var(--foreground);
          font-weight: 500;
          font-size: 0.85rem;
          transition: all 0.2s ease;
          background: rgba(255,255,255,0.03);
          border: 1px solid transparent;
        }
        .skill-post-link:hover {
          background: rgba(107,70,193,0.15);
          color: white;
          border-color: rgba(107,70,193,0.4);
          transform: translateX(4px);
        }
        .skill-post-link svg {
          flex-shrink: 0;
          opacity: 0.7;
          color: var(--accent);
        }

        /* ─── Horizontal Timeline ─── */
        .htl-section {
          overflow: hidden;
          transition: all 0.6s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .htl-scroll {
          display: flex;
          gap: 0;
          overflow-x: auto;
          padding: 2rem 1rem 2.5rem;
          scroll-behavior: smooth;
          scrollbar-width: none;
          position: relative;
        }
        .htl-scroll::-webkit-scrollbar { display: none; }
        .htl-track {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 0;
          min-width: max-content;
          padding-top: 3.5rem;
        }
        .htl-line {
          position: absolute;
          top: 28px;
          left: 20px;
          right: 20px;
          height: 3px;
          background: linear-gradient(90deg, var(--accent), var(--accent-light), var(--surface-border));
          border-radius: 2px;
          z-index: 0;
        }
        .htl-node {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 320px;
          max-width: 360px;
          position: relative;
          opacity: 0;
          transform: translateY(30px);
          animation: htlFadeUp 0.6s ease forwards;
        }
        @keyframes htlFadeUp {
          to { opacity: 1; transform: translateY(0); }
        }
        .htl-dot {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent);
          border: 3px solid var(--background);
          box-shadow: 0 0 0 3px var(--accent), 0 0 20px rgba(107,70,193,0.4);
          position: absolute;
          top: -32px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2;
          transition: box-shadow 0.3s;
        }
        .htl-node:hover .htl-dot {
          box-shadow: 0 0 0 4px var(--accent-light), 0 0 30px rgba(107,70,193,0.6);
        }
        .htl-period {
          position: absolute;
          top: -56px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--accent-light);
          white-space: nowrap;
          z-index: 3;
        }
        .htl-card {
          background: var(--card-bg);
          border: 1px solid var(--surface-border);
          border-radius: 16px;
          padding: 1.5rem;
          width: 100%;
          transition: all 0.3s ease;
          position: relative;
        }
        .htl-card::before {
          content: '';
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%) rotate(45deg);
          width: 14px;
          height: 14px;
          background: var(--card-bg);
          border-top: 1px solid var(--surface-border);
          border-left: 1px solid var(--surface-border);
        }
        .htl-node:hover .htl-card {
          transform: translateY(-6px);
          box-shadow: 0 16px 36px rgba(0,0,0,0.2);
          border-color: var(--accent);
        }
        .htl-connector {
          width: 60px;
          height: 3px;
          flex-shrink: 0;
          align-self: flex-start;
          margin-top: 0;
          position: relative;
        }
        @keyframes htlPulse {
          0%, 100% { box-shadow: 0 0 0 3px var(--accent), 0 0 20px rgba(107,70,193,0.4); }
          50% { box-shadow: 0 0 0 5px var(--accent-light), 0 0 30px rgba(107,70,193,0.6); }
        }
        .htl-node:last-child .htl-dot {
          animation: htlPulse 2s ease-in-out infinite;
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
        <section className="grid animate-fade-in" style={{ gridTemplateColumns: isExpExpanded ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', transition: 'grid-template-columns 0.5s' }}>
          {/* Experience card — timeline grows from within */}
          <div className="premium-card exp-card" style={{ cursor: 'pointer', gridColumn: isExpExpanded ? '1 / -1' : 'auto' }}>
            <div onClick={() => setIsExpExpanded(!isExpExpanded)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: isExpExpanded ? 'linear-gradient(135deg, var(--accent), var(--accent-light))' : 'var(--accent)', padding: '0.5rem', borderRadius: '8px', color: 'white', transition: 'background 0.3s' }}>
                  {isExpExpanded
                    ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                  }
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{isExpExpanded ? 'Career Timeline' : 'Experience'}</h2>
                  {isExpExpanded && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>Scroll horizontally to explore</p>}
                </div>
              </div>
              <div style={{ color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span>{isExpExpanded ? 'Close' : 'View Timeline'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s', transform: isExpExpanded ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>

            {!isExpExpanded ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {experience.slice(0, 2).map((exp, i) => (
                  <div key={exp.id} style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                    <div style={{ position: 'absolute', left: 0, top: '6px', bottom: i === 0 ? '-2rem' : 'auto', width: '2px', background: i === 0 ? 'linear-gradient(to bottom, var(--accent), transparent)' : 'transparent' }}></div>
                    <div style={{ position: 'absolute', left: '-4px', top: '6px', width: '10px', height: '10px', borderRadius: '50%', background: i === 0 ? 'var(--accent)' : 'var(--surface-border)' }}></div>
                    <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', marginBottom: '0.2rem' }}>{exp.role}</h3>
                    <p style={{ color: i === 0 ? 'var(--accent)' : 'var(--muted)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>{exp.company} | {exp.period}</p>
                    <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5 }}>{exp.description}</p>
                  </div>
                ))}
                {experience.length === 0 && <p style={{ color: 'var(--muted)' }}>No experience found.</p>}
              </div>
            ) : (
              <div className="htl-scroll animate-fade-in" style={{ margin: '0 -2rem -2rem', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                <div className="htl-track">
                  <div className="htl-line" />
                  {[...experience].reverse().map((exp, idx, arr) => (
                    <div key={exp.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
                      <div className="htl-node" style={{ animationDelay: `${idx * 0.12}s` }}>
                        <div className="htl-period">{exp.period}</div>
                        <div className="htl-dot" />
                        <div className="htl-card" style={{ marginTop: '1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: idx === arr.length - 1 ? 'var(--accent)' : 'var(--accent-light)', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: idx === arr.length - 1 ? 'var(--accent)' : 'var(--accent-light)' }}>
                              {idx === arr.length - 1 ? '\u25cf Current Role' : 'Previous Role'}
                            </span>
                          </div>
                          <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{exp.role}</h3>
                          <div style={{ color: 'var(--accent-light)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>{exp.company}</div>
                          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: exp.details?.length > 0 ? '1rem' : 0 }}>{exp.description}</p>
                          {exp.details && exp.details.length > 0 && (
                            <ul style={{ padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {exp.details.map((detail, dIdx) => (
                                <li key={dIdx} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                                  <span style={{ color: 'var(--accent)', fontWeight: 'bold', flexShrink: 0, marginTop: '1px' }}>&#8250;</span>
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      {idx < arr.length - 1 && (
                        <div style={{ width: '60px', flexShrink: 0, height: '3px', background: 'linear-gradient(90deg, var(--accent), var(--accent-light))', alignSelf: 'flex-start', marginTop: '27px', opacity: 0.35, borderRadius: '2px' }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Skills card — no-clip so popover isn't hidden */}
          <div className="premium-card no-clip">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
              <div style={{ background: 'var(--accent)', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Core Skills</h2>
            </div>
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>A multidisciplinary toolset spanning hardware control, software development, and modern web infrastructure.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {skills.map(skill => (
                <div key={skill.id} className={`skill-wrapper ${expandedSkillId === skill.id ? 'active' : ''}`}>
                  <div
                    className={`skill-badge ${skill.linkedPosts?.length > 0 ? 'has-posts' : ''}`}
                    onClick={() => {
                      if (skill.linkedPosts?.length > 0) {
                        setExpandedSkillId(expandedSkillId === skill.id ? null : skill.id);
                      }
                    }}
                  >
                    {skill.name}
                  </div>
                  {skill.linkedPosts?.length > 0 && (
                    <div className="skill-popover">
                      <div className="skill-popover-header" onClick={() => setExpandedSkillId(null)}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill.name}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                      </div>
                      <div className="skill-popover-content">
                        <div className="skill-popover-title">Click to view post</div>
                        {skill.linkedPosts.map(post => (
                          <Link
                            key={post.slug}
                            href={`/blog/${post.slug}`}
                            className="skill-post-link"
                            onClick={() => setExpandedSkillId(null)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            {post.title}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {skills.length === 0 && <p style={{ color: 'var(--muted)' }}>No skills found.</p>}
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
