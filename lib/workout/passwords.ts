import crypto from 'crypto';

const HASH_PREFIX = 'scrypt';

export function isHashedPassword(password: string | undefined | null) {
  return typeof password === 'string' && password.startsWith(`${HASH_PREFIX}$`);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedPassword: string | undefined | null) {
  if (!storedPassword) return false;
  if (!isHashedPassword(storedPassword)) {
    return storedPassword === password;
  }

  const [, salt, expectedHash] = storedPassword.split('$');
  if (!salt || !expectedHash) return false;
  const candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  if (expectedBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}
