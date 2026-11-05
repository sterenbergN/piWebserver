'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type InstallPrompt = Event & { prompt: () => Promise<void> };

/**
 * Putting the page you're on on the home screen, as its own app (each section has
 * one: lib/home-apps.ts). Android and desktop Chrome can do it from a button; iPhones
 * and iPads only from the Share menu, so those get the steps.
 */
export function useHomeScreen() {
  const [installed, setInstalled] = useState(true);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [steps, setSteps] = useState<{ name: string; ios: boolean } | null>(null);

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

  const add = () => {
    if (prompt) {
      void prompt.prompt();
      setPrompt(null); // the browser only lets each prompt be used once
      return;
    }
    // The app this page goes on as: its section's name, or the site's.
    const name = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content || 'This page';
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setSteps({ name, ios });
  };

  const dialog = steps && <HomeScreenSteps {...steps} onClose={() => setSteps(null)} />;
  return { installed, add, dialog };
}

function HomeScreenSteps({ name, ios, onClose }: { name: string; ios: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="signin-backdrop" role="dialog" aria-modal="true" aria-labelledby="home-screen-title" onClick={onClose}>
      <div className="signin-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="home-screen-title">Put {name} on your home screen</h2>
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
        <p className="signin-sub">It opens straight to {name === 'This page' ? 'this page' : name}, full screen, as its own app. Each part of the site can go on as its own app: open it first, then add it. On an iPhone or iPad you sign in once more inside the app.</p>
        <button type="button" className="btn btn-primary" onClick={onClose}>Got it</button>
      </div>
    </div>,
    document.body,
  );
}
