import Anthropic from '@anthropic-ai/sdk';
import type { AiAttachment } from './attachments';
import type { CatalogModel, ProviderId } from './providers-list';

// The calls themselves, one small pair per provider: `generate` writes a reply to a
// prompt, `check` proves a key and model work (for the admin page's Test button).
// Errors come back as AiError with a short message that's safe to show anyone:
// no key, no provider response body.

export type AiErrorKind = 'not-set-up' | 'not-allowed' | 'auth' | 'model' | 'rate' | 'timeout' | 'network' | 'refused' | 'too-long' | 'empty' | 'busy' | 'unknown';

export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) {
    super(message);
  }
}

export type GenerateRequest = { apiKey: string; model: string; prompt: string; attachments?: AiAttachment[]; signal?: AbortSignal; timeoutMs: number };
export type CheckRequest = { apiKey: string; model: string; timeoutMs: number };

export type Provider = {
  generate(req: GenerateRequest): Promise<string>;
  check(req: CheckRequest): Promise<{ modelLabel: string }>;
  /** Every text model this key can use right now, so new releases show up on their own. */
  listModels(req: { apiKey: string; timeoutMs: number }): Promise<CatalogModel[]>;
};

/**
 * Said before every prompt. The prompts were written for someone pasting them into a
 * chat app, often with notes attached, and the reply goes straight into a parser.
 */
const REPLY_RULES = [
  'Your reply is read by an app, not shown in a chat, so it is pasted straight into a parser.',
  'Follow the output format the prompt asks for exactly, and write the whole thing in one reply: there is no chance to ask questions or continue later.',
];
export const SYSTEM_PROMPT = [
  ...REPLY_RULES,
  'Nothing is attached. Where the prompt mentions attached or pasted notes, files or a syllabus, use the text included in the message (often between <material> tags); if there is none, work from the prompt alone.',
].join(' ');
/** Said instead when files came with the prompt. */
export const SYSTEM_PROMPT_WITH_FILES = [
  ...REPLY_RULES,
  'The notes, files or syllabus the prompt mentions are attached to this message (PDFs and images), along with any text between <material> tags. Work from all of them.',
].join(' ');

export const systemPromptFor = (attachments?: AiAttachment[]) => (attachments?.length ? SYSTEM_PROMPT_WITH_FILES : SYSTEM_PROMPT);

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } };

/** Claude's message: the files first (documents and images read best before the question), then the prompt. */
export function anthropicContent(prompt: string, attachments: AiAttachment[] = []): string | AnthropicBlock[] {
  if (!attachments.length) return prompt;
  return [
    ...attachments.map((a): AnthropicBlock => (a.type === 'application/pdf'
      ? { type: 'document', title: a.name, source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
      : { type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } })),
    { type: 'text', text: prompt },
  ];
}

/** Gemini's parts: the files as inline data, then the prompt. */
export function geminiParts(prompt: string, attachments: AiAttachment[] = []) {
  return [...attachments.map((a) => ({ inlineData: { mimeType: a.type, data: a.data } })), { text: prompt }];
}

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
  async generate({ apiKey, model, prompt, attachments, signal, timeoutMs }) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
    try {
      // Streamed, so a long reply (a whole practice test) doesn't hit the HTTP timeout.
      // A refusal is retried on the provider's chosen fallback model ("default").
      const message = await client.beta.messages.stream({
        model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: systemPromptFor(attachments),
        messages: [{ role: 'user', content: anthropicContent(prompt, attachments) }],
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
  async listModels({ apiKey, timeoutMs }) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
    try {
      const out: CatalogModel[] = [];
      for await (const m of client.models.list({ limit: 100 })) out.push({ id: m.id, label: m.display_name || m.id, createdAt: m.created_at });
      return out;
    } catch (error) {
      throw anthropicError(error);
    }
  },
};

// ── Google Gemini (AI Studio keys) ──────────────────────────────────────────
// Plain REST, no SDK. The key goes in a header, never in the address, so it can't
// end up in a log line. GEMINI_BASE_URL is only for pointing tests at a stand-in.

const geminiBase = () => (process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const geminiModel = (model: string) => encodeURIComponent(model.replace(/^models\//, ''));

type GeminiPart = { text?: string; thought?: boolean };
export type GeminiReply = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

/** Turn an HTTP failure into a short reason. Google's message is only looked at, never passed on. */
export function geminiError(status: number, message = ''): AiError {
  const msg = message.toLowerCase();
  if (msg.includes('leaked')) return new AiError('auth', 'Google says this API key leaked. Make a new one in AI Studio.');
  if (status === 401 || (status === 400 && msg.includes('api key')) || msg.includes('api_key_invalid')) return new AiError('auth', 'The API key was turned down.');
  if (status === 403) return new AiError('auth', 'This API key isn’t allowed to do that.');
  if (status === 404) return new AiError('model', 'That model wasn’t found for this key.');
  if (status === 429) return new AiError('rate', 'Gemini’s quota is used up for now (the free tier allows only so many a minute and a day). Try again later.');
  if (status >= 500) return new AiError('busy', 'Gemini is having trouble. Try again soon.');
  if (msg.includes('token') && (msg.includes('exceed') || msg.includes('too long') || msg.includes('limit'))) return new AiError('too-long', 'The prompt is too long for this model.');
  return new AiError('unknown', `Gemini answered with an error${status ? ` (${status})` : ''}.`);
}

async function geminiFetch(url: string, init: RequestInit & { signal: AbortSignal }) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    if (init.signal.aborted) throw new AiError('timeout', 'It took too long to answer.');
    throw new AiError('network', 'Couldn’t reach Gemini.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw geminiError(res.status, body.error?.message);
  }
  return res;
}

const GEMINI_NOT_TEXT = /(embed|image|imagen|veo|tts|audio|live|aqa|robotics|computer-use|lyria)/i;

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'LANGUAGE']);

/** The text of Gemini's answer (its thinking left out), or the reason there isn't one. */
export function readGeminiReply(reply: GeminiReply): string {
  if (reply.promptFeedback?.blockReason) throw new AiError('refused', 'Gemini declined to write this one.');
  const candidate = reply.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
  if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) throw new AiError('refused', 'Gemini declined to write this one.');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new AiError('too-long', 'The reply ran out of room before it finished.');
  if (!text) throw new AiError('empty', 'Gemini sent back nothing.');
  return text;
}

const gemini: Provider = {
  async generate({ apiKey, model, prompt, attachments, signal, timeoutMs }) {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    const res = await geminiFetch(`${geminiBase()}/v1beta/models/${geminiModel(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.any(signals),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPromptFor(attachments) }] },
        contents: [{ role: 'user', parts: geminiParts(prompt, attachments) }],
        generationConfig: { maxOutputTokens: 32000 },
      }),
    });
    const reply = (await res.json().catch(() => null)) as GeminiReply | null;
    if (!reply) throw new AiError('unknown', 'Gemini’s answer couldn’t be read.');
    return readGeminiReply(reply);
  },
  async check({ apiKey, model, timeoutMs }) {
    // Looking the model up proves the key and the model name without using any quota.
    const res = await geminiFetch(`${geminiBase()}/v1beta/models/${geminiModel(model)}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const info = (await res.json().catch(() => ({}))) as { displayName?: string; supportedGenerationMethods?: string[] };
    if (Array.isArray(info.supportedGenerationMethods) && !info.supportedGenerationMethods.includes('generateContent')) {
      throw new AiError('model', 'That model can’t write text replies.');
    }
    return { modelLabel: info.displayName || model };
  },
  async listModels({ apiKey, timeoutMs }) {
    const out: CatalogModel[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const res = await geminiFetch(`${geminiBase()}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await res.json().catch(() => ({}))) as { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
      for (const m of body.models ?? []) {
        const id = (m.name ?? '').replace(/^models\//, '');
        // Text models only: not embeddings, pictures, speech or video.
        if (!id || !m.supportedGenerationMethods?.includes('generateContent') || GEMINI_NOT_TEXT.test(id)) continue;
        out.push({ id, label: m.displayName || id });
      }
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return out;
  },
};

const IMPLEMENTATIONS: Record<ProviderId, Provider> = { anthropic, gemini };

export function providerFor(id: ProviderId): Provider {
  return IMPLEMENTATIONS[id];
}
