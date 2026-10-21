'use client';

import { useRef, useState } from 'react';
import type { ExperienceEntry } from '@/lib/resume';

/** "4 roles · 3 companies · since 2022", from the years written in each period. */
function careerSummary(experience: ExperienceEntry[]) {
  const years = experience.flatMap((e) => e.period.match(/(?:19|20)\d{2}/g) ?? []).map(Number);
  // "AWC Inc." and "AWC Inc" are one company.
  const companies = new Set(experience.map((e) => e.company.toLowerCase().replace(/[.,]/g, '').replace(/ (inc|llc|ltd|corp)$/, '').trim()).filter(Boolean)).size;
  const parts = [`${experience.length} role${experience.length === 1 ? '' : 's'}`];
  if (companies > 1) parts.push(`${companies} companies`);
  if (years.length) parts.push(`since ${Math.min(...years)}`);
  return parts.join(' · ');
}

/**
 * The current role with its highlights and a line for each earlier one, expanding in place into the full vertical career timeline.
 * `experience` is ordered newest first, and the timeline keeps that order so the
 * current role is always at the top.
 */
export default function ExperienceCard({ experience }: { experience: ExperienceEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const [current, ...earlier] = experience;
  const summary = careerSummary(experience);
  const cardRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    // When collapsing a long timeline the header may be off-screen; bring it back.
    if (!next) {
      requestAnimationFrame(() => {
        const el = cardRef.current;
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };

  return (
    <div ref={cardRef} className="premium-card exp-card" style={{ gridColumn: expanded ? '1 / -1' : 'auto' }}>
      <button className="home-card-head" aria-expanded={expanded} onClick={toggle}>
        <span className="home-card-icon" aria-hidden>
          {expanded
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <h2 className="home-card-title">{expanded ? 'Career timeline' : 'Experience'}</h2>
          {expanded && <span className="home-muted-sm">Most recent first</span>}
        </span>
        <span className="home-card-toggle">
          {expanded ? 'Close' : 'Timeline'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s', transform: expanded ? 'rotate(180deg)' : 'none' }} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {!expanded ? (
        <div className="exp-compact">
          {summary && <p className="exp-stats">{summary}</p>}
          {current && (
            <div className="exp-item is-current">
              <h3>{current.role}</h3>
              <p className="exp-where">{current.company} · {current.period}</p>
              {current.description && <p className="exp-desc">{current.description}</p>}
              {current.details?.length > 0 && (
                <ul className="exp-highlights">
                  {current.details.slice(0, 2).map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </div>
          )}
          {earlier.length > 0 && (
            <div className="exp-earlier">
              <span className="exp-earlier-label">Before that</span>
              <ol className="exp-mini">
                {earlier.slice(0, 4).map((exp) => (
                  <li key={exp.id}>
                    <span className="exp-mini-role">{exp.role}</span>
                    <span className="exp-mini-where">{exp.company}</span>
                    <span className="exp-mini-period">{exp.period}</span>
                  </li>
                ))}
              </ol>
              {earlier.length > 4 && (
                <button type="button" className="exp-more" onClick={toggle}>+{earlier.length - 4} more in the timeline</button>
              )}
            </div>
          )}
        </div>
      ) : (
        <ol className="vtl animate-fade-in">
          {experience.map((exp, idx) => {
            const current = idx === 0;
            return (
              <li key={exp.id} className={`vtl-node${current ? ' is-current' : ''}`} style={{ animationDelay: `${Math.min(idx, 6) * 0.08}s` }}>
                <span className="vtl-dot" aria-hidden />
                <div className="vtl-card">
                  <div className="vtl-meta">
                    <span className="vtl-period">{exp.period}</span>
                    {current && <span className="vtl-tag">● Current role</span>}
                  </div>
                  <h3 className="vtl-role">{exp.role}</h3>
                  <div className="vtl-company">{exp.company}</div>
                  <p className="vtl-desc" style={{ marginBottom: exp.details?.length ? '1rem' : 0 }}>{exp.description}</p>
                  {exp.details?.length > 0 && (
                    <ul className="vtl-details">
                      {exp.details.map((detail, dIdx) => <li key={dIdx}><span aria-hidden>›</span><span>{detail}</span></li>)}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
