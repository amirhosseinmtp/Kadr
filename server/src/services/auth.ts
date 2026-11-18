import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const scryptCost = 16_384;
const scryptBlockSize = 8;
const scryptParallelism = 1;
const derivedKeyLength = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, derivedKeyLength, { N: scryptCost, r: scryptBlockSize, p: scryptParallelism, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${scryptCost}$${scryptBlockSize}$${scryptParallelism}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, cost, blockSize, parallelism, saltText, expectedText] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltText || !expectedText) return false;
  const parameters = { N: Number(cost), r: Number(blockSize), p: Number(parallelism) };
  if (parameters.N !== scryptCost || parameters.r !== scryptBlockSize || parameters.p !== scryptParallelism) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(expectedText, 'base64url');
  if (salt.length !== 16 || expected.length !== derivedKeyLength) return false;
  const actual = scryptSync(password, salt, expected.length, { ...parameters, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, expected);
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
