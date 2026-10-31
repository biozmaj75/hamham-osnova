import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.mjs';
import { handler } from './index.mjs';

console.log('Running auth and API security tests...');

// 1. Password hashing and verification
const password = 'mySecurePassword123!';
const hash = hashPassword(password);
assert.ok(hash.includes(':'), 'Hash must contain salt delimiter');
assert.ok(verifyPassword(password, hash), 'Password verification should succeed for valid password');
assert.ok(!verifyPassword('wrongPassword', hash), 'Password verification should fail for invalid password');
assert.ok(!verifyPassword('', hash), 'Password verification should fail for empty password');
assert.ok(!verifyPassword(password, 'invalid-hash-format'), 'Malformed hash should return false');
assert.ok(!verifyPassword(password, null), 'Null hash should return false');

// 2. Token signing and verification
const secret = 'super-secret-key-32-chars-minimum!';
const payload = { uid: 42, v: 'abc123xyz890' };
const token = signToken(payload, secret);
assert.ok(typeof token === 'string' && token.includes('.'), 'Token must be formatted as body.sig');

const decoded = verifyToken(token, secret);
assert.ok(decoded, 'Valid token must be verified');
assert.equal(decoded.uid, 42);
assert.equal(decoded.v, 'abc123xyz890');
assert.ok(decoded.exp > Date.now(), 'Token must have future exp');

// Tampered token
const [body, sig] = token.split('.');
const tamperedBody = Buffer.from(JSON.stringify({ uid: 1, v: 'admin', exp: Date.now() + 60000 })).toString('base64url');
assert.equal(verifyToken(`${tamperedBody}.${sig}`, secret), null, 'Tampered token body must fail verification');
assert.equal(verifyToken(`${body}.${sig.slice(0, -2)}`, secret), null, 'Tampered signature must fail verification');
assert.equal(verifyToken(token, 'different-secret'), null, 'Wrong secret must fail verification');
assert.equal(verifyToken('malformed', secret), null, 'Token without dot separator must fail');

// Expired token
const expiredBody = Buffer.from(JSON.stringify({ uid: 42, v: 'abc', exp: Date.now() - 1000 })).toString('base64url');
import crypto from 'node:crypto';
const expiredSig = crypto.createHmac('sha256', secret).update(expiredBody).digest('base64url');
assert.equal(verifyToken(`${expiredBody}.${expiredSig}`, secret), null, 'Expired token must fail verification');

// 3. Handler action validation & security headers
const unknownActionRes = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ action: 'nonExistentAction' }),
});
assert.equal(unknownActionRes.statusCode, 400);
assert.equal(JSON.parse(unknownActionRes.body).error, 'Neznano dejanje');
assert.equal(unknownActionRes.headers['X-Content-Type-Options'], 'nosniff');
assert.equal(unknownActionRes.headers['X-Frame-Options'], 'DENY');

// Prototype pollution / inherited property checks on actions
const protoRes = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ action: 'toString' }),
});
assert.equal(protoRes.statusCode, 400, 'Prototype properties like toString must be rejected as unknown action');
assert.equal(JSON.parse(protoRes.body).error, 'Neznano dejanje');

const protoRes2 = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ action: '__proto__' }),
});
assert.equal(protoRes2.statusCode, 400, '__proto__ must be rejected as unknown action');
assert.equal(JSON.parse(protoRes2.body).error, 'Neznano dejanje');

// Non-string action type
const invalidTypeRes = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ action: 12345 }),
});
assert.equal(invalidTypeRes.statusCode, 400, 'Non-string action must be rejected');
assert.equal(JSON.parse(invalidTypeRes.body).error, 'Neznano dejanje');

console.log('All auth and API security tests passed successfully!');
