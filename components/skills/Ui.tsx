'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LEVELS, MAX_LEVEL } from '@/lib/skills/types';
import { levelName, type Confidence, type Tier, type TopicState, TIER_LABEL } from '@/lib/skills/model';
import SignInPrompt from '@/components/journal/SignInPrompt';

// The small pieces every Skills page shares. Styles are in app/skills/skills.css.

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="sk-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

export function SignedOutCard() {
  return (
    <SignInPrompt title="Sign in to see your skills">
      Your subjects, what you’ve read and how you did on every question are kept with your account, so they follow you between devices.
    </SignInPrompt>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="sk-error" role="alert">{children}</p>;
}

/**
 * A 0–5 bar: the solid fill is the level today, the faint fill behind it what it
 * was before fading, and the tick is the target.
 */
export function LevelBar({ level, fitted, target, size = 'md', label }: { level: number; fitted?: number; target?: number; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / MAX_LEVEL) * 100))}%`;
  const text = `${label ? `${label}: ` : ''}level ${level.toFixed(1)} of 5 (${levelName(level)})${target !== undefined ? `, target ${target}` : ''}`;
  return (
    <span className={`sk-bar is-${size}`} role="img" aria-label={text} title={text}>
      {fitted !== undefined && fitted > level + 0.05 && <span className="sk-bar-faded" style={{ width: pct(fitted) }} />}
      <span className="sk-bar-fill" style={{ width: pct(level) }} />
      {Array.from({ length: MAX_LEVEL - 1 }, (_, i) => <i key={i} className="sk-bar-step" style={{ left: pct(i + 1) }} />)}
      {target !== undefined && <span className="sk-bar-target" style={{ left: pct(target) }} />}
    </span>
  );
}

/** "3.4 · Competent" */
export function LevelText({ level }: { level: number }) {
  return <span className="sk-level-text"><strong>{level.toFixed(1)}</strong> <span>{levelName(level)}</span></span>;
}

const STATE_TEXT: Record<TopicState, { label: string; icon: string }> = {
  strong: { label: 'Strong', icon: '💪' },
  weak: { label: 'Weak', icon: '⚠️' },
  fading: { label: 'Fading', icon: '🍂' },
  untested: { label: 'Untested', icon: '❔' },
  gap: { label: 'Not started', icon: '○' },
  ok: { label: 'On track', icon: '✓' },
};

export function StateChip({ state }: { state: TopicState }) {
  const s = STATE_TEXT[state];
  return <span className={`sk-chip is-${state}`}><span aria-hidden>{s.icon}</span> {s.label}</span>;
}

const CONFIDENCE_TEXT: Record<Confidence, string> = { none: 'No evidence', self: 'Self-rated', some: 'Some evidence', verified: 'Verified' };
export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return <span className={`sk-chip is-conf-${confidence}`} title="How much the level is backed by answers">{CONFIDENCE_TEXT[confidence]}</span>;
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`sk-tier is-${tier}`}>{tier === 'sme' ? '🏅 SME' : TIER_LABEL[tier]}</span>;
}

/** The level scale, for help text and pickers. */
export function LevelScale({ highlight }: { highlight?: number }) {
  return (
    <ol className="sk-scale" start={0}>
      {LEVELS.map((l) => (
        <li key={l.level} className={highlight !== undefined && Math.floor(highlight) === l.level ? 'is-on' : ''}>
          <strong>{l.level} {l.name}</strong> <span>{l.meaning}</span>
        </li>
      ))}
    </ol>
  );
}

/** Pick a 0–5 level (whole steps), or clear it. */
export function LevelPicker({ value, onChange, label, allowClear = true }: { value?: number; onChange: (v: number | null) => void; label: string; allowClear?: boolean }) {
  return (
    <div className="sk-picker" role="radiogroup" aria-label={label}>
      {LEVELS.map((l) => (
        <button key={l.level} type="button" role="radio" aria-checked={value !== undefined && Math.round(value) === l.level} title={`${l.name}: ${l.meaning}`} onClick={() => onChange(l.level)}>
          {l.level}
        </button>
      ))}
      {allowClear && value !== undefined && <button type="button" className="sk-picker-clear" onClick={() => onChange(null)} aria-label="Clear rating">✕</button>}
    </div>
  );
}

// ── Copy a prompt, paste the reply ───────────────────────────────────────────

export function CopyPrompt({ title, prompt, children }: { title: string; prompt: string; children?: ReactNode }) {
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
    <section className={`sk-card sk-step-card${copied === 'copied' ? ' is-done' : ''}`}>
      <h2><span className="sk-step">{copied === 'copied' ? '✓' : 1}</span> {title}</h2>
      {children}
      <div className="sk-actions">
        <button type="button" className={`btn ${copied === 'copied' ? 'btn-secondary' : 'btn-primary'}`} onClick={copy}>{copied === 'copied' ? 'Copied' : 'Copy prompt'}</button>
        <button type="button" className="sk-text-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the prompt' : 'Read the prompt'}</button>
      </div>
      {copied === 'copied' && <p className="sk-hint">Now paste it into your AI app (a thinking model does best), then bring its whole reply back to step 2.</p>}
      {copied === 'failed' && <p className="sk-warning">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</p>}
      {open && <textarea ref={box} className="sk-mono" readOnly rows={10} value={prompt} aria-label="The prompt to copy" />}
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
      setFailed(true);
      box.current?.focus();
    }
  }
  return (
    <section className="sk-card sk-step-card">
      <div className="sk-card-head">
        <h2><span className="sk-step">2</span> Paste what it wrote</h2>
        <button type="button" className="sk-small-btn" onClick={paste}>Paste</button>
      </div>
      <textarea ref={box} className="sk-mono" rows={value ? 8 : 4} value={value} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => onChange(e.target.value)} />
      {failed && <p className="sk-hint">This browser wants you to paste by hand. Hold or right-click in the box.</p>}
      {children}
    </section>
  );
}
