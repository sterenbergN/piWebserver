'use client';

import { useEffect, useRef } from 'react';
import type { TemplateId } from '@/lib/notes/items';
import { PAGE_SIZES, PAPER_COLORS, TEMPLATES } from '@/lib/notes/templates';
import { drawPaper } from './paper';

// Choosing what a page looks like, with a real little picture of each kind of paper.

export type PaperChoice = { template: TemplateId; paper: string; w: number; h: number };

function Preview({ template, paper, w, h }: { template: TemplateId; paper: string; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = (78 * Math.min(window.devicePixelRatio || 1, 2)) / w;
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Hairlines vanish at this size, so a preview draws its lines heavier than the real page does.
    drawPaper(ctx, { template, paper, w, h }, 3.2);
  }, [template, paper, w, h]);
  return <canvas ref={ref} className="nt-paper-preview" style={{ aspectRatio: `${w} / ${h}` }} />;
}

export function TemplateGrid({ value, paper, w, h, onPick }: { value: TemplateId | null; paper: string; w: number; h: number; onPick: (template: TemplateId) => void }) {
  return (
    <div className="nt-templates">
      {TEMPLATES.map((template) => (
        <button key={template.id} type="button" className={value === template.id ? 'is-on' : ''} aria-pressed={value === template.id} onClick={() => onPick(template.id)}>
          <Preview template={template.id} paper={paper} w={w} h={h} />
          <span>{template.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PaperSwatches({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <div className="nt-swatches">
      {PAPER_COLORS.map(({ color, label }) => (
        <button key={color} type="button" className={`nt-swatch${value === color ? ' is-on' : ''}`} aria-label={label} title={label} aria-pressed={value === color} style={{ background: color }} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}

/** Size, way up, colour and printing: everything about a new notebook's paper. */
export function PaperPicker({ value, onChange }: { value: PaperChoice; onChange: (choice: PaperChoice) => void }) {
  const landscape = value.w > value.h;
  const long = Math.max(value.w, value.h);
  const short = Math.min(value.w, value.h);
  const current = PAGE_SIZES.find((size) => size.h === long && size.w === short)?.id ?? PAGE_SIZES[0].id;
  const setSize = (id: string, turned: boolean) => {
    const size = PAGE_SIZES.find((s) => s.id === id) ?? PAGE_SIZES[0];
    onChange({ ...value, w: turned ? size.h : size.w, h: turned ? size.w : size.h });
  };
  return (
    <>
      <div className="nt-label">Paper</div>
      <div className="nt-row is-wrap">
        <select className="nt-select" aria-label="Page size" value={current} onChange={(e) => setSize(e.target.value, landscape)}>
          {PAGE_SIZES.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
        </select>
        <div className="nt-tabs">
          <button type="button" className={!landscape ? 'is-on' : ''} aria-pressed={!landscape} onClick={() => setSize(current, false)}>Upright</button>
          <button type="button" className={landscape ? 'is-on' : ''} aria-pressed={landscape} onClick={() => setSize(current, true)}>Sideways</button>
        </div>
        <PaperSwatches value={value.paper} onPick={(paper) => onChange({ ...value, paper })} />
      </div>
      <TemplateGrid value={value.template} paper={value.paper} w={value.w} h={value.h} onPick={(template) => onChange({ ...value, template })} />
    </>
  );
}
