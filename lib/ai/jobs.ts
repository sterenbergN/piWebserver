import crypto from 'crypto';
import { createLimiter } from '@/lib/security/rate-limit';
import { AttachmentError, cleanAttachments } from './attachments';
import { AiError, type Provider } from './providers';
import { modelForTask } from './catalog';
import { connectionFor, isAiReady, type ActiveConnection, type AiCaller, type AiSettings } from './settings';
import type { AiTask } from './tasks';
import type { ProviderId } from './providers-list';

// Writing a reply runs as a job the page checks on, not one long request: a long
// reply can take minutes, and Cloudflare cuts a request off at 100 seconds. Jobs
// live in memory (one Node process on the Pi) and are forgotten a while after they
// finish. Each account gets one at a time, and a handful an hour.

export type AiJob = {
  id: string;
  owner: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  text?: string;
  error?: string;
  errorKind?: string;
};

export type AiJobView = Pick<AiJob, 'id' | 'status' | 'text' | 'error' | 'errorKind'>;

export const MAX_PROMPT_CHARS = 400_000;

type Options = {
  loadSettings: () => Promise<AiSettings>;
  providerFor: (id: ProviderId) => Provider;
  /** Which model a task uses (the newest of a family can change from day to day). */
  pickModel?: (conn: ActiveConnection, task?: AiTask) => Promise<string>;
  timeoutMs?: number;
  perHour?: number;
  keepMs?: number;
  now?: () => number;
};

export function createAiJobs({ loadSettings, providerFor, pickModel = async (conn, task) => modelForTask(conn, null, task).id, timeoutMs = 5 * 60_000, perHour = 30, keepMs = 15 * 60_000, now = Date.now }: Options) {
  const jobs = new Map<string, AiJob & { controller: AbortController }>();
  const limiter = createLimiter({ max: perHour, windowMs: 60 * 60_000 });

  const prune = () => {
    const t = now();
    for (const [id, job] of jobs) {
      if (job.status !== 'running' && t - (job.finishedAt ?? t) > keepMs) jobs.delete(id);
    }
  };

  const view = (job: AiJob): AiJobView => ({ id: job.id, status: job.status, text: job.text, error: job.error, errorKind: job.errorKind });

  return {
    /**
     * Start writing a reply to `prompt` for `owner` (who is `who`), with any attached files
     * (checked here; held in memory only while the request runs). Throws AiError when it can't start.
     */
    async start(owner: string, prompt: string, who: AiCaller, task?: AiTask, files?: unknown): Promise<AiJobView> {
      prune();
      if (typeof prompt !== 'string' || !prompt.trim()) throw new AiError('empty', 'There’s no prompt to send.');
      if (prompt.length > MAX_PROMPT_CHARS) throw new AiError('too-long', 'That prompt is too long to send.');
      let attachments;
      try {
        attachments = cleanAttachments(files);
      } catch (error) {
        throw new AiError('too-long', error instanceof AttachmentError ? error.message : 'Those files couldn’t be read.');
      }
      const settings = await loadSettings();
      // The account's own key if the admin gave it one, else the site's if it may share it.
      const conn = connectionFor(settings, who);
      if (!conn) {
        if (isAiReady(settings)) throw new AiError('not-allowed', 'This account can’t use the site’s AI.');
        throw new AiError('not-set-up', 'No AI is connected.');
      }
      if ([...jobs.values()].some((j) => j.owner === owner && j.status === 'running')) {
        throw new AiError('busy', 'It’s already writing one. Wait for that to finish.');
      }
      const wait = limiter.retryAfter(owner, now());
      if (wait > 0) throw new AiError('rate', `That’s a lot of AI for one hour. Try again in ${Math.ceil(wait / 60)} minutes.`);
      limiter.hit(owner, now());

      const model = await pickModel(conn, task);
      const controller = new AbortController();
      const job = { id: crypto.randomUUID(), owner, status: 'running' as AiJob['status'], startedAt: now(), controller };
      jobs.set(job.id, job);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const finish = (patch: Partial<AiJob>) => {
        clearTimeout(timer);
        Object.assign(job, patch, { finishedAt: now() });
      };
      // Not awaited: the page asks how it's going.
      void providerFor(conn.provider)
        .generate({ apiKey: conn.apiKey, model, prompt, attachments, signal: controller.signal, timeoutMs })
        .then((text) => finish({ status: 'done', text }))
        .catch((error) => {
          const e = error instanceof AiError ? error : new AiError('unknown', 'Something went wrong talking to the AI.');
          // The kind only: never the prompt, the reply or anything with the key in it.
          console.warn(`AI reply failed (${e.kind})`);
          finish({ status: 'error', error: e.message, errorKind: e.kind });
        });
      return view(job);
    },

    /** How a job is going; null if there's no such job for this owner. */
    get(owner: string, id: string): AiJobView | null {
      prune();
      const job = jobs.get(id);
      return job && job.owner === owner ? view(job) : null;
    },

    /** Stop a running job (the page was closed or Cancel pressed). */
    cancel(owner: string, id: string) {
      const job = jobs.get(id);
      if (job && job.owner === owner && job.status === 'running') job.controller.abort();
    },
  };
}
