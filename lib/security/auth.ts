import crypto from 'crypto';

type TokenPayload = {
  role: 'admin' | 'workout';
  userId?: string;
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

function getSessionSecret() {
  const secret =
    process.env.PI_DASHBOARD_SESSION_SECRET ||
    process.env.WORKOUT_SESSION_SECRET ||
    process.env.PI_DASHBOARD_PASSWORD;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Missing session secret');
  }

  return 'development-only-session-secret-change-me';
}

function signValue(value: string) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function createSignedToken(payload: TokenPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;

  try {
    const [encodedPayload, providedSignature] = token.split('.');
    if (!encodedPayload || !providedSignature) return null;

    const expectedSignature = signValue(encodedPayload);
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const providedBuffer = Buffer.from(providedSignature, 'utf-8');
    if (expectedBuffer.length !== providedBuffer.length) return null;
    if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;
    if (!payload?.role || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAdminAuthToken() {
  return createSignedToken({
    role: 'admin',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

export function createWorkoutAuthToken(userId: string) {
  return createSignedToken({
    role: 'workout',
    userId,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
}

export function isAdminTokenValid(token: string | undefined | null) {
  const payload = verifySignedToken(token);
  return payload?.role === 'admin';
}

export function getWorkoutUserIdFromToken(token: string | undefined | null) {
  const payload = verifySignedToken(token);
  if (payload?.role !== 'workout' || !payload.userId) return null;
  return payload.userId;
}
