// A tiny ring buffer of recent script errors, so a ticket can say what went wrong
// on the page. Installed once, when the feedback button first appears.

const KEY = '__ticketErrors';
type W = Window & { [KEY]?: string[] };

export function installErrorBuffer() {
  const w = window as W;
  if (w[KEY]) return;
  const list: string[] = (w[KEY] = []);
  const push = (text: string) => {
    list.push(text.replace(/\s+/g, ' ').slice(0, 300));
    if (list.length > 10) list.shift();
  };
  window.addEventListener('error', (e) => push(`${e.message || 'Error'}${e.filename ? ` (${e.filename.replace(location.origin, '')}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push(`Unhandled rejection: ${r instanceof Error ? r.message : String(r)}`);
  });
}

export const recentErrors = (): string[] => [...((window as W)[KEY] ?? [])];
