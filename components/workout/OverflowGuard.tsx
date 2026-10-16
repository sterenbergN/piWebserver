'use client';

import { useEffect } from 'react';

// Development-only layout check for the workout pages: flags any element whose
// content spills out of its box (e.g. button text that doesn't wrap and runs
// past the button on a phone) and any horizontal page scroll. Flagged elements
// get a red dashed outline and a console warning; `window.__workoutOverflow`
// holds the current list so a test or a person can read it. Does nothing in
// production builds.

const CHECKED = 'button, a, label, summary, h1, h2, h3, h4, p, strong, small, [role="button"], .workout-tile, .workout-sheet-body > *';

function describe(el: Element) {
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? ` class="${el.className}"` : ''}> “${text}”`;
}

function findOverflow(): Element[] {
  const found: Element[] = [];
  document.querySelectorAll('.workout-mobile-container, .workout-sheet').forEach((root) => {
    root.querySelectorAll(CHECKED).forEach((el) => {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) return;
      const style = getComputedStyle(el);
      // Scrollable or clipped boxes overflow on purpose.
      if (style.overflowX !== 'visible' || style.textOverflow === 'ellipsis') return;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) found.push(el);
    });
  });
  return found;
}

export default function OverflowGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastReport = '';

    const check = () => {
      timer = null;
      document.querySelectorAll('[data-overflow]').forEach((el) => el.removeAttribute('data-overflow'));
      const found = findOverflow();
      found.forEach((el) => el.setAttribute('data-overflow', ''));
      const pageScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      (window as any).__workoutOverflow = { elements: found.map(describe), pageScroll };
      const report = [...found.map(describe), pageScroll ? 'page scrolls sideways' : ''].filter(Boolean).join('\n');
      if (report && report !== lastReport) console.warn(`[OverflowGuard] content spills out of its box:\n${report}`);
      lastReport = report;
    };
    // Re-check at most once a second (the tracker re-renders every second).
    const schedule = () => { if (!timer) timer = setTimeout(check, 1000); };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
