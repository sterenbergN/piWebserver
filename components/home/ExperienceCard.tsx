'use client';

import { useState } from 'react';
import type { ExperienceEntry } from '@/lib/resume';

/** The two latest roles, expanding in place into a horizontal career timeline. */
export default function ExperienceCard({ experience }: { experience: ExperienceEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="premium-card exp-card" style={{ gridColumn: expanded ? '1 / -1' : 'auto' }}>
      <button className="home-card-head" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span className="home-card-icon" aria-hidden>
          {expanded
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <h2 className="home-card-title">{expanded ? 'Career timeline' : 'Experience'}</h2>
          {expanded && <span className="home-muted-sm">Scroll sideways to explore</span>}
        </span>
        <span className="home-card-toggle">
          {expanded ? 'Close' : 'Timeline'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s', transform: expanded ? 'rotate(180deg)' : 'none' }} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {!expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {experience.slice(0, 2).map((exp, i) => (
            <div key={exp.id} className={`exp-item${i === 0 ? ' is-current' : ''}`}>
              <h3>{exp.role}</h3>
              <p className="exp-where">{exp.company} · {exp.period}</p>
              <p className="exp-desc">{exp.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="htl-scroll animate-fade-in">
          <div className="htl-track">
            <div className="htl-line" />
            {[...experience].reverse().map((exp, idx, arr) => (
              <div key={exp.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div className="htl-node" style={{ animationDelay: `${idx * 0.12}s` }}>
                  <div className="htl-period">{exp.period}</div>
                  <div className="htl-dot" />
                  <div className="htl-card">
                    <div className="htl-tag" data-current={idx === arr.length - 1 || undefined}>{idx === arr.length - 1 ? '● Current role' : 'Previous role'}</div>
                    <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{exp.role}</h3>
                    <div style={{ color: 'var(--accent-light)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>{exp.company}</div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: exp.details?.length ? '1rem' : 0 }}>{exp.description}</p>
                    {exp.details?.length > 0 && (
                      <ul className="htl-details">
                        {exp.details.map((detail, dIdx) => <li key={dIdx}><span aria-hidden>›</span><span>{detail}</span></li>)}
                      </ul>
                    )}
                  </div>
                </div>
                {idx < arr.length - 1 && <div className="htl-connector" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
