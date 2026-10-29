import crypto from 'node:crypto';

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const DUMMY_SALT = '00000000000000000000000000000000';
const DUMMY_HASH_BUF = Buffer.alloc(64, 0);

export function verifyPassword(password, stored) {
  const isWellFormed = typeof stored === 'string' && stored.includes(':');
  const [salt, hashHex] = isWellFormed ? stored.split(':') : [DUMMY_SALT, ''];

  const expected = Buffer.from(hashHex || '', 'hex');
  const validLength = expected.length === 64;

  // Always compute scrypt key to prevent timing attacks on hash presence or format
  const test = crypto.scryptSync(String(password || ''), salt || DUMMY_SALT, 64);

  // Safely compare using timingSafeEqual with fixed-length buffers
  const compareBuf = validLength ? expected : DUMMY_HASH_BUF;
  const match = crypto.timingSafeEqual(compareBuf, test);

  return isWellFormed && validLength && match;
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
