'use client';

import type { Components } from 'react-markdown';
import type { CadProject } from '@/lib/site-content';
import { cadHref, cadIdFrom } from '@/lib/cad/embeds';
import CadCard from '@/components/home/CadCard';

/** A CAD model's card in a post, as it is in the CAD section right now. */
export function CadEmbed({ id, projects }: { id: string; projects: CadProject[] }) {
  const cad = projects.find((p) => p.id === id);
  if (!cad) return <p className="cad-embed-missing">🧊 The CAD model “{id}” isn’t in the CAD section (any more).</p>;
  return (
    <figure className="cad-embed">
      <CadCard cad={cad} />
      <figcaption className="cad-embed-foot">
        <a href={cadHref(cad.id)}>🧊 See it with the other CAD models →</a>
      </figcaption>
    </figure>
  );
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

/**
 * A Markdown `pre` that shows "cad" code blocks as the model's card and
 * leaves every other code block alone.
 */
export function cadPre(projects: CadProject[]): Components['pre'] {
  return function Pre({ node, children, ...props }) {
    const code = (node as HastNode | undefined)?.children?.[0];
    const classes = code?.tagName === 'code' ? code.properties?.className : null;
    if (Array.isArray(classes) && classes.includes('language-cad')) {
      const text = (code?.children ?? []).map((c) => c.value ?? '').join('');
      return <CadEmbed id={cadIdFrom(text)} projects={projects} />;
    }
    return <pre {...props}>{children}</pre>;
  };
}
