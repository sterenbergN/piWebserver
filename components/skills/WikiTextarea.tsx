'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import type { LinkableName } from '@/lib/skills/links';
import { skillsGet } from './api';

// A text box that suggests names as a [[link]] is typed, as Obsidian does: type [[ and the start of a
// skill, topic, book or lookup, then pick one with the arrows and Enter (or a tap). It works the same
// whether the box's value is held by React or only read when it loses focus.

const KIND_LABEL: Record<LinkableName['kind'], string> = { subject: 'skill', topic: 'topic', resource: 'resource', lookup: 'lookup' };

/** The names, asked for once and shared by every box on the page; asked again after a minute, since they change. */
let cache: { at: number; names: Promise<LinkableName[]> } | null = null;
function linkNames() {
  if (!cache || Date.now() - cache.at > 60_000) {
    const names = skillsGet<{ names: LinkableName[] }>({ names: '1' }).then((r) => r.names, () => []);
    cache = { at: Date.now(), names };
  }
  return cache.names;
}

/** The text of an unfinished [[link]] right before the cursor, or null if there isn't one. */
export function openLink(before: string) {
  const m = /\[\[([^[\]\n|]{0,80})$/.exec(before);
  return m ? m[1] : null;
}

/** The best names for what's been typed: starting with it first, then containing it. */
export function suggestNames(names: LinkableName[], typed: string, limit = 6) {
  const q = typed.trim().toLowerCase();
  const scored = names
    .map((n) => {
      const name = n.name.toLowerCase();
      const at = q ? name.indexOf(q) : 0;
      return { n, rank: at < 0 ? -1 : at === 0 ? 0 : 1 };
    })
    .filter((x) => x.rank >= 0);
  scored.sort((a, b) => a.rank - b.rank || a.n.name.length - b.n.name.length || a.n.name.localeCompare(b.n.name));
  return scored.slice(0, limit).map((x) => x.n);
}

/** Put a chosen name into the box: the [[typed text becomes [[name]], and any ]] already after the cursor isn't doubled. */
export function completeLink(value: string, cursor: number, name: string) {
  const before = value.slice(0, cursor).replace(/\[\[([^[\]\n|]*)$/, `[[${name}]]`);
  const after = value.slice(cursor).replace(/^[^[\]\n]*\]\]/, '');
  return { value: before + after, cursor: before.length };
}

export default function WikiTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { onKeyDown, onBlur, onInput, onClick, className, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [names, setNames] = useState<LinkableName[]>([]);
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let live = true;
    void linkNames().then((n) => { if (live) setNames(n); });
    return () => { live = false; };
  }, []);

  const matches = typed === null ? [] : suggestNames(names, typed);
  const open = matches.length > 0;

  function look() {
    const el = ref.current;
    if (!el) return;
    setTyped(el.selectionStart === el.selectionEnd ? openLink(el.value.slice(0, el.selectionStart)) : null);
    setActive(0);
  }

  function choose(name: string) {
    const el = ref.current;
    if (!el) return;
    const next = completeLink(el.value, el.selectionStart, name);
    // Through the element's own setter and an input event, so React's onChange (if any) hears it.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.setSelectionRange(next.cursor, next.cursor);
    setTyped(null);
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(matches[Math.min(active, matches.length - 1)].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTyped(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="wk-wrap">
      <textarea
        {...rest}
        ref={ref}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onKeyDown={keys}
        onKeyUp={(e) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) look(); }}
        onInput={(e) => { onInput?.(e); look(); }}
        onClick={(e) => { onClick?.(e); look(); }}
        onBlur={(e) => { setTyped(null); onBlur?.(e); }}
      />
      {open && (
        <ul className="wk-suggest" role="listbox" id={listId} aria-label="Link to">
          {matches.map((n, i) => (
            <li
              key={`${n.kind}:${n.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              // Before the box loses focus: a tap mustn't count as leaving it (that saves some boxes half-written).
              onMouseDown={(e) => { e.preventDefault(); choose(n.name); }}
            >
              <strong>{n.name}</strong>
              <span>{KIND_LABEL[n.kind]}{n.detail ? ` · ${n.detail}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
