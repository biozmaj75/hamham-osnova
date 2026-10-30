import assert from 'node:assert';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.mjs';

const SECRET = 'test-secret-key-12345';

console.log('Running auth tests...');

// 1. Test password hashing and verification
const pwd = 'MySecretPassword123!';
const hash = hashPassword(pwd);
assert.strictEqual(verifyPassword(pwd, hash), true, 'Valid password should verify');
assert.strictEqual(verifyPassword('WrongPassword', hash), false, 'Wrong password should fail');
assert.strictEqual(verifyPassword(pwd, 'invalidhashformat'), false, 'Malformed hash should fail');

// 2. Test valid token signing and verification
const payload = { uid: 42, v: '123456789012' };
const token = signToken(payload, SECRET);
const decoded = verifyToken(token, SECRET);
assert.notStrictEqual(decoded, null, 'Token should decode successfully');
assert.strictEqual(decoded.uid, 42, 'UID should match');
assert.strictEqual(decoded.v, '123456789012', 'Version tag should match');

// 3. Test verification with wrong secret
assert.strictEqual(verifyToken(token, 'wrong-secret'), null, 'Verification with wrong secret should fail');

// 4. Test malformed token strings
assert.strictEqual(verifyToken(null, SECRET), null, 'null token should return null');
assert.strictEqual(verifyToken('', SECRET), null, 'empty token should return null');
assert.strictEqual(verifyToken('invalidtoken', SECRET), null, 'token without dots should return null');
assert.strictEqual(verifyToken('part1.part2.part3', SECRET), null, 'token with 3 parts should return null');

// 5. Test token with multi-byte unicode characters in signature (formerly caused RangeError in timingSafeEqual)
const [body, sig] = token.split('.');
const unicodeSigToken = `${body}.€${sig.slice(1)}`;
assert.doesNotThrow(() => {
  const res = verifyToken(unicodeSigToken, SECRET);
  assert.strictEqual(res, null, 'Unicode signature token should return null without throwing');
}, 'verifyToken should handle unicode signatures without throwing RangeError');

// 6. Test expired token
const expiredBody = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() - 1000 })).toString('base64url');
const expiredSig = import('node:crypto').then(crypto => {
  const sig = crypto.createHmac('sha256', SECRET).update(expiredBody).digest('base64url');
  const expiredToken = `${expiredBody}.${sig}`;
  assert.strictEqual(verifyToken(expiredToken, SECRET), null, 'Expired token should return null');
  console.log('All auth tests passed successfully! ✅');
});
