'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

// The two steps every AI-written thing goes through: copy a prompt into her AI, and
// paste back what it wrote. Copying is the point of step one, so the long prompt
// itself stays folded away unless she wants to read it.

export function CopyPrompt({ title = 'Copy this into your AI, with your notes', prompt, children }: { title?: string; prompt: string; children?: ReactNode }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setCopied('idle'), [prompt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      // Some phones refuse the clipboard: show it, selected, to copy by hand.
      setOpen(true);
      setCopied('failed');
      window.setTimeout(() => { box.current?.focus(); box.current?.select(); }, 0);
    }
  }

  return (
    <section className={`sd-card sd-flow-step${copied === 'copied' ? ' is-done' : ''}`}>
      <h2><span className="sd-step">{copied === 'copied' ? <Icon name="check" size="0.95rem" /> : 1}</span> {title}</h2>
      {children}
      <div className="sd-actions">
        <button type="button" className={`btn ${copied === 'copied' ? 'btn-secondary' : 'btn-primary'}`} onClick={copy}>
          <Icon name={copied === 'copied' ? 'check' : 'copy'} /> {copied === 'copied' ? 'Copied' : 'Copy prompt'}
        </button>
        <button type="button" className="hb-text-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the prompt' : 'Read the prompt'}</button>
      </div>
      {copied === 'copied' && <p className="sd-next-hint">Now open your AI, attach your notes and paste. Bring its reply back to step 2.</p>}
      {copied === 'failed' && <p className="sd-warning">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</p>}
      {open && <textarea ref={box} className="sd-prompt" readOnly rows={8} value={prompt} aria-label="The prompt to copy" />}
    </section>
  );
}

export function PasteReply({ value, onChange, children }: { value: string; onChange: (text: string) => void; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      setFailed(false);
      if (text) onChange(text);
    } catch {
      // Most phones won't let a page read the clipboard, so the box is the way in.
      setFailed(true);
      box.current?.focus();
    }
  }

  return (
    <section className="sd-card sd-flow-step">
      <div className="sd-card-head">
        <h2><span className="sd-step">2</span> Paste what it wrote</h2>
        <button type="button" className="hb-small-btn sd-with-icon" onClick={paste}><Icon name="paste" /> Paste</button>
      </div>
      <textarea ref={box} className="sd-reply" rows={value ? 8 : 4} value={value} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => onChange(e.target.value)} />
      {failed && <p className="hb-hint">This browser wants you to paste by hand. Hold or right-click in the box.</p>}
      {children}
    </section>
  );
}
