'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Skill } from '@/lib/resume';

/** Skill badges; ones with linked posts open a small list of those posts. */
export default function SkillsCard({ skills, intro }: { skills: Skill[]; intro?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Sideways nudge so an opened popover (centred on its badge) stays on screen.
  const [shift, setShift] = useState(0);
  const activeWrapperRef = useRef<HTMLDivElement>(null);
  const activePopoverRef = useRef<HTMLDivElement>(null);

  const clampPopover = () => {
    const wrapper = activeWrapperRef.current;
    const popover = activePopoverRef.current;
    if (!wrapper || !popover) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const wRect = wrapper.getBoundingClientRect();
    const pWidth = popover.offsetWidth || Math.min(250, vw - 24);
    const idealLeft = wRect.left + wRect.width / 2 - pWidth / 2;
    const clampedLeft = Math.min(Math.max(idealLeft, 12), Math.max(12, vw - 12 - pWidth));
    setShift(clampedLeft - idealLeft);
  };

  useLayoutEffect(() => {
    if (!openId) {
      setShift(0);
      return;
    }
    clampPopover();
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (activeWrapperRef.current && !activeWrapperRef.current.contains(e.target as Node)) {
        setOpenId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    const onResize = () => clampPopover();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [openId]);

  const toggle = (id: string) => {
    setShift(0);
    setOpenId((prev) => (prev === id ? null : id));
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
          const isOpen = openId === skill.id;
          return (
            <div
              key={skill.id}
              ref={isOpen ? activeWrapperRef : undefined}
              className={`skill-wrapper${isOpen ? ' active' : ''}`}
            >
              {hasPosts ? (
                <button type="button" className="skill-badge has-posts" aria-expanded={isOpen} onClick={() => toggle(skill.id)}>{skill.name}</button>
              ) : (
                <span className="skill-badge">{skill.name}</span>
              )}
              {hasPosts && (
                <div
                  ref={isOpen ? activePopoverRef : undefined}
                  className="skill-popover"
                  aria-hidden={!isOpen}
                  style={isOpen ? { left: `calc(50% + ${shift}px)` } : undefined}
                >
                  <button
                    type="button"
                    className="skill-popover-header"
                    tabIndex={isOpen ? 0 : -1}
                    onClick={() => setOpenId(null)}
                    aria-label={`Close ${skill.name}`}
                  >
                    <span>{skill.name}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  <div className="skill-popover-content">
                    <div className="skill-popover-title">Related posts</div>
                    {skill.linkedPosts.map(post => (
                      <Link key={post.slug} href={`/blog/${post.slug}`} className="skill-post-link" tabIndex={isOpen ? 0 : -1} onClick={() => setOpenId(null)}>
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
