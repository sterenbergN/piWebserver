'use client';

import { useEffect, useRef, useState } from 'react';
import { AiClientError, generateReply, useAiStatus } from '@/lib/ai/client';
import type { AiAttachment } from '@/lib/ai/attachments';
import type { AiTask } from '@/lib/ai/tasks';
import { fileSize, pickFiles } from './attach-files';
import './ai.css';

// "Generate" for any copy-prompt / paste-reply flow. It only shows when the site has
// an AI connected (Admin → AI). It writes the reply into the same box a pasted reply
// goes in, so the page's own reading, preview and save steps run as before. When
// anything goes wrong it says so in a line and copy-paste is right there.


export type GenerateMaterial = {
  /** Asks for the text the prompt expects to be attached (notes, a syllabus…). */
  label: string;
  placeholder?: string;
  /** Without it Generate stays off: the prompt makes no sense without the text (or a file). */
  required?: boolean;
  /** Offer to attach PDFs and photos, sent to the AI with the prompt. */
  files?: boolean;
};

export default function GenerateReply({ task, prompt, onReply, check, material, disabled, className }: {
  /** Which job this is, so it uses the model chosen for it in Admin → AI. */
  task: AiTask;
  /** The prompt, or a way to get it (some pages build it on the server). */
  prompt: string | (() => Promise<string>);
  /** Put the reply where a pasted one goes. */
  onReply: (text: string) => void;
  /** The page's own reader: a message when the reply can't be used, null when it can. */
  check?: (text: string) => string | null;
  material?: GenerateMaterial;
  disabled?: boolean;
  className?: string;
}) {
  const status = useAiStatus();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AiAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const run = useRef<AbortController | null>(null);

  // Leaving the page stops the job.
  useEffect(() => () => run.current?.abort(), []);
  useEffect(() => {
    if (state !== 'busy') return;
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [state]);

  if (!status?.ready) return null;
  const model = status.models?.[task] ?? status.model;
  const needsText = !!material?.required && !text.trim() && !files.length;

  const attach = async (chosen: File[]) => {
    if (!chosen.length) return;
    setReading(true);
    try {
      const picked = await pickFiles(chosen, files);
      setFiles((prev) => [...prev, ...picked.attachments]);
      if (picked.text.length) setText((prev) => [prev.trim(), ...picked.text.map((t) => t.trim())].filter(Boolean).join('\n\n'));
      setFileProblems(picked.problems);
    } finally {
      setReading(false);
    }
  };

  const go = async () => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setState('busy');
    setSeconds(0);
    setMessage('');
    try {
      const base = typeof prompt === 'string' ? prompt : await prompt();
      if (!base.trim()) throw new AiClientError('There’s nothing to ask yet.');
      const full = material && text.trim() ? `${base}\n\n<material>\n${text.trim()}\n</material>` : base;
      const reply = await generateReply(full, task, controller.signal, material?.files ? files : []);
      if (controller.signal.aborted) return;
      onReply(reply);
      const problem = check?.(reply);
      if (problem) {
        setState('error');
        // The page's own message is about pasting, so it isn't repeated here; the text is in the box to look at.
        setMessage(`${model}’s reply came out in a form this page can’t read. Generate again, or copy the prompt into your own AI.`);
      } else {
        setState('done');
        setMessage('Filled in. Check it over before you save.');
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof AiClientError && error.kind === 'cancelled')) {
        setState('idle');
        return;
      }
      setState('error');
      const reason = error instanceof Error ? error.message.replace(/\.$/, '') : 'Something went wrong';
      setMessage(`Couldn’t generate it: ${reason}. Copy the prompt and paste the reply instead.`);
    } finally {
      if (run.current === controller) run.current = null;
    }
  };

  return (
    <div className={`ai-gen${className ? ` ${className}` : ''}`}>
      {material && (
        <label className="ai-gen-material">
          <span>{material.label}</span>
          <textarea rows={text ? 5 : 3} value={text} placeholder={material.placeholder ?? 'Paste the text here'} onChange={(e) => setText(e.target.value)} disabled={state === 'busy'} />
        </label>
      )}
      {material?.files && (
        <div className="ai-gen-files">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/*,text/plain,.txt,.md"
            onChange={(e) => { const chosen = [...(e.target.files ?? [])]; e.target.value = ''; void attach(chosen); }}
          />
          <button type="button" className="ai-gen-attach" disabled={state === 'busy' || reading} onClick={() => picker.current?.click()}>
            <span aria-hidden>📎</span> {reading ? 'Reading…' : files.length ? 'Attach more' : 'Attach PDFs or photos'}
          </button>
          {files.length > 0 && (
            <ul className="ai-gen-file-list" aria-label="Attached files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span aria-hidden>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                  <span className="ai-gen-file-name">{f.name}</span>
                  <span className="ai-gen-file-size">{fileSize(f)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} disabled={state === 'busy'} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
          {fileProblems.map((p) => <p key={p} className="ai-gen-error" role="alert">{p}</p>)}
          {files.length > 0 && <p className="ai-gen-hint">Sent to {model} with this request only; not kept on this site. Slides: save as PDF first.</p>}
        </div>
      )}
      <div className="ai-gen-row">
        {state === 'busy' ? (
          <>
            <span className="ai-gen-spinner" aria-hidden />
            <span className="ai-gen-status" role="status">Writing with {model}… {seconds > 0 && <span className="ai-gen-time">{seconds}s</span>}</span>
            <button type="button" className="ai-gen-link" onClick={() => run.current?.abort()}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary ai-gen-btn" disabled={disabled || needsText || reading} onClick={go}>
              <span aria-hidden>✨</span> {state === 'idle' ? 'Generate' : 'Generate again'}
            </button>
            <span className="ai-gen-note">
              {needsText ? (material?.files ? 'Attach your notes or paste them above, or copy the prompt into your own AI.' : 'Add the text above, or copy the prompt into your own AI.') : `with ${model}, or paste a reply from your own AI`}
            </span>
          </>
        )}
      </div>
      {state === 'busy' && seconds >= 20 && <p className="ai-gen-hint">Long replies can take a couple of minutes.</p>}
      {message && state !== 'busy' && <p className={state === 'error' ? 'ai-gen-error' : 'ai-gen-ok'} role={state === 'error' ? 'alert' : undefined}>{message}</p>}
    </div>
  );
}
