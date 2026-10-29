import assert from 'node:assert';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.mjs';

console.log('Testing password hashing and verification...');

// Test 1: Valid password
const pwd = 'securePassword123!';
const hash = hashPassword(pwd);
assert.strictEqual(typeof hash, 'string');
assert.ok(hash.includes(':'));
assert.strictEqual(verifyPassword(pwd, hash), true, 'Valid password should verify correctly');

// Test 2: Invalid password
assert.strictEqual(verifyPassword('wrongPassword', hash), false, 'Wrong password should fail');

// Test 3: Null / undefined / invalid inputs
assert.strictEqual(verifyPassword(null, hash), false, 'Null password should fail');
assert.strictEqual(verifyPassword(pwd, null), false, 'Null stored hash should fail');
assert.strictEqual(verifyPassword(pwd, undefined), false, 'Undefined stored hash should fail');
assert.strictEqual(verifyPassword(pwd, ''), false, 'Empty string stored hash should fail');
assert.strictEqual(verifyPassword(pwd, 'invalidhashstring'), false, 'Malformed stored hash should fail');
assert.strictEqual(verifyPassword(pwd, 'salt:short'), false, 'Short hash in stored value should fail');

// Test 4: Token signing and verification
const secret = 'super-secret-key-123';
const payload = { uid: 42, v: 'abc' };
const token = signToken(payload, secret);
assert.strictEqual(typeof token, 'string');
assert.ok(token.includes('.'));

const verifiedPayload = verifyToken(token, secret);
assert.strictEqual(verifiedPayload.uid, 42);
assert.strictEqual(verifiedPayload.v, 'abc');

assert.strictEqual(verifyToken(token, 'wrong-secret'), null, 'Wrong secret should fail verification');
assert.strictEqual(verifyToken('invalid.token', secret), null, 'Invalid signature should fail verification');

console.log('All auth tests passed successfully!');
