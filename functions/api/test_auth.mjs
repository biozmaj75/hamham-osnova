import assert from 'node:assert';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.mjs';

// Password hashing and verification
const hashed = hashPassword('secret123');
assert.strictEqual(verifyPassword('secret123', hashed), true);
assert.strictEqual(verifyPassword('wrong', hashed), false);

// Non-string or malformed inputs for verifyPassword
assert.strictEqual(verifyPassword(null, hashed), false);
assert.strictEqual(verifyPassword(undefined, hashed), false);
assert.strictEqual(verifyPassword(12345, hashed), false);
assert.strictEqual(verifyPassword('secret123', null), false);
assert.strictEqual(verifyPassword('secret123', 'invalidhash'), false);
assert.strictEqual(verifyPassword('secret123', 'salt:hash:extra'), false);

// Token signing and verification
const secret = 'test-secret-key-12345';
const token = signToken({ uid: 42, role: 'admin' }, secret);
const verified = verifyToken(token, secret);
assert.strictEqual(verified.uid, 42);
assert.strictEqual(verified.role, 'admin');

// Invalid or tampered tokens
assert.strictEqual(verifyToken(null, secret), null);
assert.strictEqual(verifyToken(undefined, secret), null);
assert.strictEqual(verifyToken(12345, secret), null);
assert.strictEqual(verifyToken('invalidtoken', secret), null);
assert.strictEqual(verifyToken('invalid.token.extra', secret), null);

// Tampered signature
const [b, s] = token.split('.');
const tamperedSig = s.slice(0, -1) + (s.slice(-1) === 'a' ? 'b' : 'a');
assert.strictEqual(verifyToken(`${b}.${tamperedSig}`, secret), null);

// Expired token
const expiredBody = Buffer.from(JSON.stringify({ uid: 42, exp: Date.now() - 1000 })).toString('base64url');
const crypto = await import('node:crypto');
const expiredSig = crypto.createHmac('sha256', secret).update(expiredBody).digest('base64url');
assert.strictEqual(verifyToken(`${expiredBody}.${expiredSig}`, secret), null);

console.log('✅ All auth tests passed successfully!');
