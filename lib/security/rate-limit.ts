// In-memory rate limits (one Node process on the Pi, so memory is enough).
// A limiter counts events per key inside a rolling window; once a key hits
// `max`, it's blocked until its window ends.

type Bucket = { count: number; resetAt: number };

export function createLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const buckets = new Map<string, Bucket>();
  const live = (key: string, now: number) => {
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) { buckets.delete(key); return null; }
    return b;
  };
  return {
    /** Seconds until `key` may try again, or 0 if it isn't blocked. */
    retryAfter(key: string, now = Date.now()) {
      const b = live(key, now);
      return b && b.count >= max ? Math.ceil((b.resetAt - now) / 1000) : 0;
    },
    /** Count one event (a failed login, a submission…). */
    hit(key: string, now = Date.now()) {
      const b = live(key, now);
      if (b) b.count++;
      else buckets.set(key, { count: 1, resetAt: now + windowMs });
      // Keep the map from growing without bound under a flood of new keys.
      if (buckets.size > 5000) for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    },
    reset(key: string) { buckets.delete(key); },
  };
}

/** Best guess at the visitor's address when behind a trusted proxy (`TRUST_PROXY=1`). */
export function clientAddress(request: Request) {
  if (process.env.TRUST_PROXY !== '1') return 'unknown';
  const h = request.headers;
  return h.get('cf-connecting-ip')?.trim() || h.get('x-real-ip')?.trim() || h.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

// Password guessing: 5 wrong tries per address/account per 15 minutes. The overall
// cap still slows an attacker who rotates accounts or addresses.
const perAddress = createLimiter({ max: 5, windowMs: 15 * 60_000 });
const overall = createLimiter({ max: 60, windowMs: 15 * 60_000 });

function loginBucketKey(request: Request, scope: string, identifier?: string) {
  const ip = clientAddress(request);
  const id = identifier?.trim().toLowerCase();
  if (ip !== 'unknown') {
    return id ? `${scope}:${ip}:${id}` : `${scope}:${ip}`;
  }
  if (id && id !== 'admin') {
    return `${scope}:unknown:${id}`;
  }
  const ua = (request.headers.get('user-agent') || '').trim().slice(0, 160);
  return `${scope}:unknown:${id || scope}:${ua || 'no-ua'}`;
}

/** Seconds to wait before another login attempt from this request (0 = go ahead). */
export function loginRetryAfter(request: Request, scope: string, identifier?: string) {
  return Math.max(perAddress.retryAfter(loginBucketKey(request, scope, identifier)), overall.retryAfter(scope));
}

export async function recordLoginFailure(request: Request, scope: string, identifier?: string) {
  perAddress.hit(loginBucketKey(request, scope, identifier));
  overall.hit(scope);
  // A short pause makes rapid guessing slower still.
  await new Promise((r) => setTimeout(r, 400));
}

export function recordLoginSuccess(request: Request, scope: string, identifier?: string) {
  perAddress.reset(loginBucketKey(request, scope, identifier));
}

export const tooManyAttemptsMessage = (seconds: number) =>
  `Too many attempts. Try again in ${seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`;
