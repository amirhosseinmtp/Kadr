import assert from 'node:assert/strict';
import test from 'node:test';
import { constantTimeEqual, createOpaqueToken, hashPassword, hashToken, verifyPassword } from './auth.js';

test('password hashes verify the original secret and reject a different one', () => {
  const hash = hashPassword('a strong local passphrase');
  assert.notEqual(hash, 'a strong local passphrase');
  assert.equal(verifyPassword('a strong local passphrase', hash), true);
  assert.equal(verifyPassword('a different passphrase', hash), false);
});

test('password verifier rejects malformed or unsupported hashes', () => {
  assert.equal(verifyPassword('anything', 'plain-text'), false);
  assert.equal(verifyPassword('anything', 'scrypt$999$8$1$invalid$invalid'), false);
});

test('opaque invitations are unpredictable and are stored as one-way hashes', () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.equal(first.length >= 40, true);
  assert.notEqual(first, second);
  assert.notEqual(hashToken(first), first);
  assert.equal(hashToken(first), hashToken(first));
});

test('CSRF comparison accepts equal values and rejects unequal values', () => {
  assert.equal(constantTimeEqual('token-a', 'token-a'), true);
  assert.equal(constantTimeEqual('token-a', 'token-b'), false);
  assert.equal(constantTimeEqual('short', 'longer'), false);
});
