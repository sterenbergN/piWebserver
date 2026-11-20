import Anthropic from '@anthropic-ai/sdk';
import type { ProviderId } from './providers-list';

// The calls themselves, one small pair per provider: `generate` writes a reply to a
// prompt, `check` proves a key and model work (for the admin page's Test button).
// Errors come back as AiError with a short message that's safe to show anyone:
// no key, no provider response body.

export type AiErrorKind = 'not-set-up' | 'auth' | 'model' | 'rate' | 'timeout' | 'network' | 'refused' | 'too-long' | 'empty' | 'busy' | 'unknown';

export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) {
    super(message);
  }
}

export type GenerateRequest = { apiKey: string; model: string; prompt: string; signal?: AbortSignal; timeoutMs: number };
export type CheckRequest = { apiKey: string; model: string; timeoutMs: number };

export type Provider = {
  generate(req: GenerateRequest): Promise<string>;
  check(req: CheckRequest): Promise<{ modelLabel: string }>;
};

/**
 * Said before every prompt. The prompts were written for someone pasting them into a
 * chat app, often with notes attached, and the reply goes straight into a parser.
 */
export const SYSTEM_PROMPT = [
  'Your reply is read by an app, not shown in a chat, so it is pasted straight into a parser.',
  'Follow the output format the prompt asks for exactly, and write the whole thing in one reply: there is no chance to ask questions or continue later.',
  'Nothing is attached. Where the prompt mentions attached or pasted notes, files or a syllabus, use the text included in the message (often between <material> tags); if there is none, work from the prompt alone.',
].join(' ');

function anthropicError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', 'It took too long to answer.');
  if (error instanceof Anthropic.APIUserAbortError) return new AiError('timeout', 'It took too long to answer.');
  if (error instanceof Anthropic.AuthenticationError) return new AiError('auth', 'The API key was turned down.');
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'This API key isn’t allowed to do that.');
  if (error instanceof Anthropic.NotFoundError) return new AiError('model', 'That model wasn’t found for this key.');
  if (error instanceof Anthropic.RateLimitError) return new AiError('rate', 'The AI provider says to slow down. Try again in a minute.');
  if (error instanceof Anthropic.BadRequestError) {
    // Out of credit comes back as a 400 too; the message is the provider's own and has no secrets.
    const msg = error.message.toLowerCase();
    if (msg.includes('credit') || msg.includes('billing')) return new AiError('auth', 'The API account is out of credit.');
    if (msg.includes('too long') || msg.includes('context')) return new AiError('too-long', 'The prompt is too long for this model.');
    return new AiError('unknown', 'The AI provider turned the request down.');
  }
  if (error instanceof Anthropic.APIConnectionError) return new AiError('network', 'Couldn’t reach the AI provider.');
  if (error instanceof Anthropic.InternalServerError) return new AiError('busy', 'The AI provider is having trouble. Try again soon.');
  if (error instanceof Anthropic.APIError) return new AiError('unknown', `The AI provider answered with an error${error.status ? ` (${error.status})` : ''}.`);
  return new AiError('unknown', 'Something went wrong talking to the AI.');
}

const anthropic: Provider = {
  async generate({ apiKey, model, prompt, signal, timeoutMs }) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
    try {
      // Streamed, so a long reply (a whole practice test) doesn't hit the HTTP timeout.
      // A refusal is retried on the provider's chosen fallback model ("default").
      const message = await client.beta.messages.stream({
        model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }, { signal, timeout: timeoutMs }).finalMessage();
      if (message.stop_reason === 'refusal') throw new AiError('refused', 'The AI declined to write this one.');
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
      if (message.stop_reason === 'max_tokens') throw new AiError('too-long', 'The reply ran out of room before it finished.');
      if (!text) throw new AiError('empty', 'The AI sent back nothing.');
      return text;
    } catch (error) {
      if (signal?.aborted) throw new AiError('timeout', 'It took too long to answer.');
      throw anthropicError(error);
    }
  },
  async check({ apiKey, model, timeoutMs }) {
    // Looking the model up proves the key and the model name without spending anything.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
    try {
      const info = await client.models.retrieve(model);
      return { modelLabel: info.display_name || model };
    } catch (error) {
      throw anthropicError(error);
    }
  },
};

const IMPLEMENTATIONS: Record<ProviderId, Provider> = { anthropic };

export function providerFor(id: ProviderId): Provider {
  return IMPLEMENTATIONS[id];
}
