// The browser half of the AI connection: is there one, and write a reply to a
// prompt. The page never talks to the provider and never sees the key; it asks this
// site, which runs the request as a job and is checked on until it's done.

import { useEffect, useState } from 'react';

import type { AiAttachment } from './attachments';
import { stripCodeFence } from './reply';
import type { AiTask } from './tasks';

/** `model` is the default's name, `models` each task's, both as people read them. */
export type AiStatus = { ready: false } | { ready: true; provider: string; model: string; models?: Partial<Record<AiTask, string>> };

let cached: Promise<AiStatus> | null = null;

/** Whether Generate should show. Asked once per page load; a failure means no. */
export function loadAiStatus(refresh = false): Promise<AiStatus> {
  if (!cached || refresh) {
    cached = fetch('/api/ai', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { ready: false }))
      .then((s: AiStatus) => (s && s.ready ? s : { ready: false as const }))
      .catch(() => ({ ready: false as const }));
  }
  return cached;
}

export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    void loadAiStatus().then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, []);
  return status;
}

export class AiClientError extends Error {
  constructor(message: string, readonly kind = 'unknown') {
    super(message);
  }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new AiClientError('Stopped.', 'cancelled')); }, { once: true });
});

async function readError(r: Response) {
  const body = await r.json().catch(() => ({})) as { error?: string; errorKind?: string };
  return new AiClientError(body.error || `The site answered ${r.status}.`, body.errorKind || (r.status === 401 ? 'signed-out' : 'unknown'));
}

/**
 * Write a reply to `prompt` with the connected AI, without a code fence wrapped around
 * the whole of it. Throws AiClientError with a short reason.
 */
export async function generateReply(prompt: string, task: AiTask, signal?: AbortSignal, attachments: AiAttachment[] = []): Promise<string> {
  let r: Response;
  try {
    r = await fetch('/api/ai/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, task, ...(attachments.length ? { attachments } : {}) }), signal });
  } catch {
    throw new AiClientError(signal?.aborted ? 'Stopped.' : 'Couldn’t reach the site.', signal?.aborted ? 'cancelled' : 'network');
  }
  if (!r.ok) throw await readError(r);
  const { id } = await r.json() as { id: string };
  const stop = () => { void fetch(`/api/ai/jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  // Quick checks first, then every few seconds: most replies take a while.
  for (let attempt = 0; ; attempt++) {
    await wait(attempt < 5 ? 1000 : 2500, signal);
    let job: { status: string; text?: string; error?: string; errorKind?: string };
    try {
      const res = await fetch(`/api/ai/jobs?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
      if (!res.ok) throw await readError(res);
      job = await res.json();
    } catch (error) {
      if (signal?.aborted) throw new AiClientError('Stopped.', 'cancelled');
      if (error instanceof AiClientError) throw error;
      // A dropped check (a phone changing networks) isn't the end: keep asking for a bit.
      if (attempt < 200) continue;
      throw new AiClientError('Lost touch with the site.', 'network');
    }
    if (job.status === 'done') return stripCodeFence(job.text ?? '');
    if (job.status === 'error') throw new AiClientError(job.error || 'The AI couldn’t write it.', job.errorKind);
  }
}
