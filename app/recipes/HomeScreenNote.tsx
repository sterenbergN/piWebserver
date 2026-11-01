'use client';

import { useEffect, useState } from 'react';

type InstallPrompt = Event & { prompt: () => Promise<void> };

/**
 * Puts the recipe box on a phone's home screen. Android and desktop Chrome can do
 * it from a button; iPhones only from the Share menu, so those get the steps.
 * Only shown where it isn't installed already, and quiet enough to always be here.
 */
export default function HomeScreenNote() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (installed) return;
    setShow(true);
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!show) return null;

  const add = () => {
    if (prompt) {
      void prompt.prompt();
      setPrompt(null); // the browser only lets each prompt be used once
    } else {
      setShowSteps(true);
    }
  };

  return (
    <>
      <button type="button" className="rc-home-note" onClick={add}>
        <span aria-hidden="true">📲</span> Put the recipe box on your home screen
      </button>

      {showSteps && (
        <div className="rc-sheet-backdrop" onClick={() => setShowSteps(false)}>
          <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="Add to your home screen" onClick={(e) => e.stopPropagation()}>
            <div className="rc-sheet-head">
              <h2>Add to your home screen</h2>
              <button type="button" className="rc-icon-btn" onClick={() => setShowSteps(false)} aria-label="Close">
                ×
              </button>
            </div>
            <ol className="rc-home-steps">
              {ios ? (
                <>
                  <li>Tap <strong>Share</strong> in the browser’s toolbar.</li>
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
            <p className="rc-meta">It opens straight to your recipes, full screen, as its own app. Your saved recipes and list still open with no signal at the store.</p>
          </div>
        </div>
      )}
    </>
  );
}
