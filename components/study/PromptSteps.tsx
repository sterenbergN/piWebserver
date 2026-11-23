'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import GenerateReply, { type GenerateMaterial } from '@/components/ai/GenerateReply';
import { useAiStatus } from '@/lib/ai/client';
import type { AiTask } from '@/lib/ai/tasks';
import { Icon } from './Icon';

// The two steps every AI-written thing goes through. With the site's AI connected
// (Admin → AI) that's choosing what to make, then attaching notes and Generate; copying
// the prompt into her own AI and pasting the reply back stays underneath, folded away.
// Without it, it's the copy-paste pair: copy a prompt into her AI, paste back what it
// wrote. Either way the long prompt itself stays folded away unless she wants to read it.

/** Whether Generate leads (an AI is connected for this account). Until that's known, copy-paste. */
const useGenerateFirst = () => useAiStatus()?.ready === true;

export function CopyPrompt({ title = 'Copy this into your AI, with your notes', setupTitle = 'What to make', prompt, children }: { title?: string; setupTitle?: string; prompt: string; children?: ReactNode }) {
  const generateFirst = useGenerateFirst();
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

  if (generateFirst) {
    return (
      <section className="sd-card sd-flow-step">
        <h2><span className="sd-step">1</span> {setupTitle}</h2>
        {children}
        <details className="sd-fallback" open={copied === 'failed' || undefined}>
          <summary>Use your own AI instead: copy the prompt</summary>
          <div className="sd-actions">
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <Icon name={copied === 'copied' ? 'check' : 'copy'} /> {copied === 'copied' ? 'Copied' : 'Copy prompt'}
            </button>
            <button type="button" className="hb-text-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the prompt' : 'Read the prompt'}</button>
          </div>
          {copied === 'copied' && <p className="sd-next-hint">Paste it into your AI with your notes or slides, then paste its reply under step 2.</p>}
          {copied === 'failed' && <p className="sd-warning">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</p>}
          {open && <textarea ref={box} className="sd-prompt" readOnly rows={8} value={prompt} aria-label="The prompt to copy" />}
        </details>
      </section>
    );
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

/**
 * Step 2. Given the prompt, it also offers Generate when the site has an AI
 * connected, filling the same box; `check` is the page's reader, `material` asks
 * for the notes the prompt expects to be attached.
 */
export function PasteReply({ value, onChange, prompt, task = 'study-tests', check, material, children }: {
  value: string;
  onChange: (text: string) => void;
  prompt?: string;
  /** Which model setting (Admin → AI) Generate uses. */
  task?: AiTask;
  check?: (text: string) => string | null;
  material?: GenerateMaterial;
  children?: ReactNode;
}) {
  const generateFirst = useGenerateFirst();
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

  if (generateFirst && prompt !== undefined) {
    return (
      <section className="sd-card sd-flow-step">
        <h2><span className="sd-step">2</span> Write it with AI</h2>
        <GenerateReply task={task} prompt={prompt} onReply={onChange} check={check} material={material} />
        <details className="sd-fallback">
          <summary>{value ? 'See or edit the reply' : 'Or paste a reply from your own AI'}</summary>
          <div className="sd-actions">
            <button type="button" className="hb-small-btn sd-with-icon" onClick={paste}><Icon name="paste" /> Paste</button>
          </div>
          <textarea ref={box} className="sd-reply" rows={value ? 8 : 4} value={value} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => onChange(e.target.value)} />
          {failed && <p className="hb-hint">This browser wants you to paste by hand. Hold or right-click in the box.</p>}
        </details>
        {children}
      </section>
    );
  }

  return (
    <section className="sd-card sd-flow-step">
      <div className="sd-card-head">
        <h2><span className="sd-step">2</span> Paste what it wrote</h2>
        <button type="button" className="hb-small-btn sd-with-icon" onClick={paste}><Icon name="paste" /> Paste</button>
      </div>
      {prompt !== undefined && <GenerateReply task={task} prompt={prompt} onReply={onChange} check={check} material={material} />}
      <textarea ref={box} className="sd-reply" rows={value ? 8 : 4} value={value} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => onChange(e.target.value)} />
      {failed && <p className="hb-hint">This browser wants you to paste by hand. Hold or right-click in the box.</p>}
      {children}
    </section>
  );
}
