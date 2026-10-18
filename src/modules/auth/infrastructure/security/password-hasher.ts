import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Hashes a plaintext password using node:crypto scrypt with a unique 16-byte cryptographic salt.
 * Produces a format of `${saltHex}:${derivedKeyHex}`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored salt:hash string using timing-safe comparison.
 */
export async function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  const parts = combinedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  if (keyBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(keyBuffer, derivedKey);
}
