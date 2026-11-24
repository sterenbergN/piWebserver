'use client';

import { useEffect } from 'react';

// Script errors anyone hits, sent to the site as its own tickets (POST /api/tickets/auto),
// so a bug shows up in Admin › Tickets without someone having to report it. Each
// different error is sent once per page load, five at most. Only in the real site:
// local development would fill the tickets with work in progress (set localStorage
// "autoTickets:dev" to "1" to try it locally).

const MAX_PER_LOAD = 5;

export function reportProblem(message: string, extra: { detail?: string; source?: 'browser' | 'ai' } = {}) {
  try {
    const body = JSON.stringify({ source: extra.source ?? 'browser', message: message.slice(0, 300), detail: extra.detail?.slice(0, 600), page: location.pathname + location.search });
    void fetch('/api/tickets/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never cause trouble of its own */ }
}

const enabled = () => {
  try {
    return process.env.NODE_ENV === 'production' || localStorage.getItem('autoTickets:dev') === '1';
  } catch {
    return false;
  }
};

export default function AutoErrorReporter() {
  useEffect(() => {
    if (!enabled()) return;
    const sent = new Set<string>();
    const send = (message: string, detail?: string) => {
      const key = message.slice(0, 200);
      if (!message || sent.has(key) || sent.size >= MAX_PER_LOAD) return;
      sent.add(key);
      reportProblem(message, { detail });
    };
    const stackOf = (error: unknown) => (error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : undefined);
    const onError = (e: ErrorEvent) => {
      const where = e.filename ? ` (${e.filename.replace(location.origin, '')}:${e.lineno})` : '';
      // Errors from browser extensions aren't the site's.
      if (/^(chrome|moz|safari)(-web)?-extension:/.test(e.filename ?? '')) return;
      send(`${e.message || 'Error'}${where}`, stackOf(e.error));
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      send(`Unhandled rejection: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r)}`, stackOf(r));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
