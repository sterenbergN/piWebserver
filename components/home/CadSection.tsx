'use client';

import { useState } from 'react';
import type { CadProject } from '@/lib/site-content';

const PREVIEW = 4;

/** CAD models: the first few, with a button to show the rest. */
export default function CadSection({ projects }: { projects: CadProject[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? projects : projects.slice(0, PREVIEW);

  return (
    <section className="premium-card home-cad">
      <div className="home-section-head" style={{ textAlign: 'center', display: 'block' }}>
        <h2>CAD models &amp; designs</h2>
        <p className="home-muted">3D parts and models, hosted externally.</p>
      </div>
      <div className="home-cad-grid">
        {shown.map(cad => {
          const Tag = cad.link ? 'a' : 'div';
          return (
            <Tag key={cad.id} className="home-cad-item" {...(cad.link ? { href: cad.link, target: '_blank', rel: 'noreferrer' } : {})}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                <h3>{cad.name}</h3>
                {cad.link && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-light)' }} aria-hidden><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                )}
              </div>
              {cad.description && <p>{cad.description}</p>}
            </Tag>
          );
        })}
      </div>
      {projects.length > PREVIEW && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button className="btn btn-secondary" style={{ borderRadius: '30px' }} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show fewer' : `Show all ${projects.length}`}
          </button>
        </div>
      )}
    </section>
  );
}
