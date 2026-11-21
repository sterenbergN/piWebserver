'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { SECTION_TITLES, groupBy, keyText, shortcutsFor, type Combo, type Shortcut } from '@/lib/shortcuts';

// Read once on the client; this only ever renders inside the (client-only) search panel.
const never = () => () => {};
const isMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
// No hover means a finger, not a mouse: typed commands matter more there than key combos.
const isTouch = () => window.matchMedia('(hover: none)').matches;

const Keys = ({ combos, mac }: { combos: Combo[]; mac: boolean }) => (
  <>
    {combos.map((combo, i) => (
      <Fragment key={i}>
        <span className="sk-combo">
          {combo.map((token, j) => (
            <Fragment key={j}>
              {j > 0 && <span className="sk-plus" aria-hidden>+</span>}
              <kbd>{keyText(token, mac)}</kbd>
            </Fragment>
          ))}
        </span>
      </Fragment>
    ))}
  </>
);

function Row({ s, mac, touch, signedIn }: { s: Shortcut; mac: boolean; touch: boolean; signedIn: boolean }) {
  // Only key presses: on a phone these are still true, just not what you'd reach for.
  const keyboardOnly = touch && !s.typed?.length && !!s.keys?.length;
  return (
    <li className={`sk-row${keyboardOnly ? ' is-keyboard' : ''}`}>
      <span className="sk-keys">
        {s.typed?.map((t) => <code key={t}>{t}</code>)}
        {s.label && <em>{s.label}</em>}
        {s.keys && <Keys combos={s.keys} mac={mac} />}
      </span>
      <span className="sk-does">
        {s.does}
        {keyboardOnly && <span className="sk-tag">keyboard</span>}
        {s.signedIn && !signedIn && <span className="sk-tag">signed in</span>}
        {s.notInTextField && <span className="sk-tag is-quiet" title="Not while typing in a box">not in a text box</span>}
      </span>
    </li>
  );
}

function Group({ title, entries, ...rest }: { title?: string; entries: Shortcut[]; mac: boolean; touch: boolean; signedIn: boolean }) {
  return (
    <div className="sk-group">
      {title && <h4>{title}</h4>}
      <ul>{entries.map((s) => <Row key={s.id} s={s} {...rest} />)}</ul>
    </div>
  );
}

/**
 * A key to the quick actions and keyboard shortcuts, from lib/shortcuts.ts. Shows
 * the shortcuts for the page you're on first, and leads with typed commands on a
 * phone, where a keyboard usually isn't there.
 */
export default function ShortcutsKey({ pathname, signedIn, onBack }: { pathname: string; signedIn: boolean; onBack: () => void }) {
  const mac = useSyncExternalStore(never, isMac, () => false);
  const touch = useSyncExternalStore(never, isTouch, () => false);
  const { anywhere, search, here, other } = shortcutsFor(pathname);
  const props = { mac, touch, signedIn };

  const searchSection = (
    <section key="search" aria-labelledby="sk-search">
      <h3 id="sk-search">{SECTION_TITLES.search}</h3>
      {groupBy(search, (s) => s.group).map(([g, list]) => <Group key={g} title={g} entries={list} {...props} />)}
    </section>
  );
  const anywhereSection = (
    <section key="anywhere" aria-labelledby="sk-anywhere">
      <h3 id="sk-anywhere">{SECTION_TITLES.anywhere}</h3>
      {groupBy(anywhere, (s) => s.group).map(([g, list]) => <Group key={g} title={g} entries={list} {...props} />)}
    </section>
  );
  // Phones lead with what you can type; computers with what you can press.
  const lead = touch ? [searchSection, anywhereSection] : [anywhereSection, searchSection];

  return (
    <div className="sk">
      <div className="sk-head">
        <button type="button" className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>Quick actions and shortcuts</h2>
      </div>
      <p className="sk-note">
        {touch
          ? 'Typed commands work anywhere in the search box. Key combos are for when a keyboard is connected.'
          : <>Typed commands like <code>/note</code> work in the search box on any device. {mac ? '⌘ is Command.' : 'On a Mac, Ctrl is ⌘.'}</>}
      </p>
      {lead}
      {here.length > 0 && (
        <section aria-labelledby="sk-here">
          <h3 id="sk-here">On this page · {[...new Set(here.map((s) => s.page))].join(', ')}</h3>
          {groupBy(here, (s) => s.page).map(([g, list]) => <Group key={g} title={g} entries={list} {...props} />)}
        </section>
      )}
      {other.length > 0 && (
        <section aria-labelledby="sk-other">
          <h3 id="sk-other">Other pages</h3>
          {groupBy(other, (s) => s.page).map(([g, list]) => <Group key={g} title={g} entries={list} {...props} />)}
        </section>
      )}
    </div>
  );
}
