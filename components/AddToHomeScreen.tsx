'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { customIconUrl, glyphUrl, iconApp, ICON_COLORS, ICON_SYMBOLS, shade, symbolId } from '@/lib/home-icons';
import { currentIconSlug, loadHomeIcons, setHomeIcons, useHomeIcons } from './useHomeIcons';

type InstallPrompt = Event & { prompt: () => Promise<void> };

/**
 * Putting the page you're on on the home screen, as its own app (each section has
 * one: lib/home-apps.ts), with the icon picked first (lib/home-icons.ts). Android and
 * desktop Chrome can do it from a button; iPhones and iPads only from the Share menu,
 * so those get the steps.
 */
export function useHomeScreen() {
  const [installed, setInstalled] = useState(true);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [sheet, setSheet] = useState<{ name: string; ios: boolean; slug: string | null; mode: 'add' | 'icon' } | null>(null);

  useEffect(() => {
    setInstalled(window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const open = (mode: 'add' | 'icon') => {
    // The app this page goes on as: its section's name, or the site's.
    const name = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content || 'This page';
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setSheet({ name, ios, slug: currentIconSlug(), mode });
  };
  // Always the sheet first, so the icon can be picked before the browser's own install.
  const add = () => open('add');
  const changeIcon = () => open('icon');
  /** Whether this page installs as a section's own app, whose icon can be picked. */
  const canPickIcon = () => currentIconSlug() !== null;

  const install = prompt ? () => { void prompt.prompt(); setPrompt(null); /* each prompt can be used once */ } : null;
  const dialog = sheet && <HomeScreenSheet {...sheet} install={install} onClose={() => setSheet(null)} />;
  return { installed, add, changeIcon, canPickIcon, dialog };
}

function HomeScreenSheet({ name, ios, slug, mode, install, onClose }: { name: string; ios: boolean; slug: string | null; mode: 'add' | 'icon'; install: (() => void) | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="signin-backdrop" role="dialog" aria-modal="true" aria-labelledby="home-screen-title" onClick={onClose}>
      <div className="signin-card home-screen-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="home-screen-title">{mode === 'icon' ? `${name}’s home screen icon` : `Put ${name} on your home screen`}</h2>
        {slug && <IconPicker slug={slug} />}
        {mode === 'icon' ? (
          <p className="signin-sub">An icon already on your home screen keeps the old look: remove it, then open this page in {ios ? 'Safari' : 'the browser'} and add it again.</p>
        ) : install ? (
          <button type="button" className="btn btn-primary" onClick={() => { install(); onClose(); }}>Add to home screen</button>
        ) : (
          <ol className="home-screen-steps">
            {ios ? (
              <>
                <li>Tap <strong>Share</strong> in Safari’s toolbar (the square with an arrow).</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong>.</li>
              </>
            ) : (
              <>
                <li>Open the browser’s menu, usually <strong>⋮</strong> in a corner.</li>
                <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
                <li>Tap <strong>Add</strong> or <strong>Install</strong>.</li>
              </>
            )}
          </ol>
        )}
        {mode === 'add' && <p className="signin-sub">It opens straight to {name === 'This page' ? 'this page' : name}, full screen, as its own app. Each part of the site can go on as its own app: open it first, then add it. On an iPhone or iPad you sign in once more inside the app.</p>}
        <button type="button" className={`btn ${mode === 'add' && install ? 'btn-secondary' : 'btn-primary'}`} onClick={onClose}>{mode === 'add' && !install ? 'Got it' : 'Done'}</button>
      </div>
    </div>,
    document.body,
  );
}

/** Pick the symbol and colour, saved to the account; the page's icon links follow at once. */
function IconPicker({ slug }: { slug: string }) {
  const app = iconApp(slug);
  const { loaded, signedIn, icons } = useHomeIcons();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void loadHomeIcons(); }, []);
  if (!app || !loaded) return null;
  if (!signedIn) return <p className="signin-sub">Sign in to pick this app’s icon and colour.</p>;

  const chosen = icons[slug] ?? null;
  const shown = chosen ?? { symbol: app.symbol, color: app.color };
  const preview = chosen ? customIconUrl(chosen, 'apple-touch-icon') : app.icon('apple-touch-icon');

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/home-icons', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, ...body }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.message || data.error || 'Couldn’t save the icon.');
      setHomeIcons(data.icons);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the icon.');
    } finally {
      setSaving(false);
    }
  };
  const pick = (next: { symbol: string; color: string }) => {
    // Back to exactly the section's own icon: nothing to keep.
    if (!app.art && next.symbol === app.symbol && next.color === app.color) void save({ reset: true });
    else void save(next);
  };

  return (
    <div className="hs-picker" aria-busy={saving}>
      <div className="hs-preview">
        <img src={preview} alt={`${app.name} icon`} width={72} height={72} />
        <div>
          <strong>{app.name}</strong>
          <span>{chosen ? 'Your icon' : app.art ? 'The original drawing' : 'The original icon'}</span>
          {chosen && <button type="button" className="hs-reset" disabled={saving} onClick={() => void save({ reset: true })}>Use the original</button>}
        </div>
      </div>
      <p className="hs-label">Colour</p>
      <div className="hs-colors" role="group" aria-label="Icon colour">
        {ICON_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            aria-label={c.name}
            title={c.name}
            aria-pressed={shown.color === c.hex}
            disabled={saving}
            style={{ background: `linear-gradient(135deg, ${shade(c.hex, 1.15)}, ${shade(c.hex, 0.7)})` }}
            onClick={() => pick({ symbol: shown.symbol, color: c.hex })}
          />
        ))}
      </div>
      <p className="hs-label">Symbol</p>
      <div className="hs-symbols" role="group" aria-label="Icon symbol">
        {ICON_SYMBOLS.map((symbol) => {
          const id = symbolId(symbol);
          return (
            <button
              key={id}
              type="button"
              aria-label={symbol}
              aria-pressed={!!chosen && shown.symbol === id || (!chosen && !app.art && app.symbol === id)}
              disabled={saving}
              style={{ background: `linear-gradient(135deg, ${shade(shown.color, 1.15)}, ${shade(shown.color, 0.7)})` }}
              onClick={() => pick({ symbol: id, color: shown.color })}
            >
              <img src={glyphUrl(id)} alt="" width={30} height={30} />
            </button>
          );
        })}
      </div>
      {error && <p className="signin-error" role="alert">{error}</p>}
    </div>
  );
}
