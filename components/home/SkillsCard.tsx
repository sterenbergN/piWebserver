'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Skill } from '@/lib/resume';

/** Skill badges; ones with linked posts open a small list of those posts. */
export default function SkillsCard({ skills, intro }: { skills: Skill[]; intro?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Sideways nudge so an opened popover (centred on its badge) stays on screen.
  const [shift, setShift] = useState(0);

  const open = (id: string, badge: HTMLElement) => {
    if (openId === id) { setOpenId(null); return; }
    const rect = badge.getBoundingClientRect();
    const width = Math.min(250, window.innerWidth * 0.8);
    const left = rect.left + rect.width / 2 - width / 2;
    const clamped = Math.min(Math.max(left, 12), window.innerWidth - 12 - width);
    setShift(clamped - left);
    setOpenId(id);
  };

  return (
    <div className="premium-card no-clip">
      <div className="home-card-head" style={{ cursor: 'default' }}>
        <span className="home-card-icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
        </span>
        <h2 className="home-card-title">Core skills</h2>
      </div>
      {intro && <p style={{ color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>{intro}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
        {skills.map(skill => {
          const hasPosts = skill.linkedPosts?.length > 0;
          return (
            <div key={skill.id} className={`skill-wrapper${openId === skill.id ? ' active' : ''}`}>
              {hasPosts ? (
                <button className="skill-badge has-posts" aria-expanded={openId === skill.id} onClick={(e) => open(skill.id, e.currentTarget)}>{skill.name}</button>
              ) : (
                <span className="skill-badge">{skill.name}</span>
              )}
              {hasPosts && (
                <div className="skill-popover" style={openId === skill.id ? { left: `calc(50% + ${shift}px)` } : undefined}>
                  <button className="skill-popover-header" onClick={() => setOpenId(null)} aria-label={`Close ${skill.name}`}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill.name}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  <div className="skill-popover-content">
                    <div className="skill-popover-title">Related posts</div>
                    {skill.linkedPosts.map(post => (
                      <Link key={post.slug} href={`/blog/${post.slug}`} className="skill-post-link" onClick={() => setOpenId(null)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                        {post.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
