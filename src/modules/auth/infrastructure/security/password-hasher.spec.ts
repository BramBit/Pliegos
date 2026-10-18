import { hashPassword, verifyPassword } from './password-hasher';

describe('password-hasher (scrypt)', () => {
  it('hashes and verifies passwords correctly', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await hashPassword(password);

    expect(hash).toContain(':');
    const [salt, key] = hash.split(':');
    expect(salt).toHaveLength(32); // 16 bytes in hex
    expect(key).toHaveLength(128); // 64 bytes in hex

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword('WrongPassword123!', hash);
    expect(isInvalid).toBe(false);
  });

  it('generates unique salts for identical passwords', async () => {
    const password = 'IdenticalPassword123!';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });
});
