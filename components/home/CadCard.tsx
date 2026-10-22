import type { ReactNode } from 'react';
import type { CadProject } from '@/lib/site-content';
import ModelViewer from './ModelViewer';
import './cad.css';

/**
 * One CAD model: its 3D view (when it has a model file), name and description,
 * linking out to where it's hosted. Used by the home page's CAD section and by
 * posts that show the model. `children` sit on the card (e.g. admin buttons).
 */
export default function CadCard({ cad, id, className = '', children }: { cad: CadProject; id?: string; className?: string; children?: ReactNode }) {
  const Tag = cad.link ? 'a' : 'div';
  return (
    <div id={id} className={`home-cad-cell${cad.model ? ' has-model' : ''} ${className}`.trim()}>
      {cad.model && <ModelViewer src={`/api/media${cad.model}`} name={cad.name} size={cad.modelSize} />}
      <Tag className="home-cad-item" {...(cad.link ? { href: cad.link, target: '_blank', rel: 'noreferrer' } : {})}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
          <h3>{cad.name}</h3>
          {cad.link && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-light)' }} aria-hidden><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          )}
        </div>
        {cad.description && <p>{cad.description}</p>}
      </Tag>
      {children}
    </div>
  );
}
