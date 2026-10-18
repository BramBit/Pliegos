import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { PostgresUserRepository } from './postgres-user.repository';
import { hashToken } from '../../security/token-hasher';
import { asUserId } from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('PostgresUserRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresUserRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    repo = new PostgresUserRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM refresh_tokens;');
    await pool.query('DELETE FROM users;');
  });

  it('creates and finds users by email (case-insensitive) and by id', async () => {
    const user = await repo.create({
      email: 'Contractor@Empresa.COM',
      passwordHash: 'dummy-hash:123',
      role: 'user',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('contractor@empresa.com');
    expect(user.role).toBe('user');

    const byEmail = await repo.findByEmail('CONTRACTOR@empresa.com');
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(user.id);

    const byId = await repo.findById(user.id);
    expect(byId).not.toBeNull();
    expect(byId?.email).toBe('contractor@empresa.com');
  });

  it('enforces unique email regardless of case', async () => {
    await repo.create({
      email: 'unique@example.com',
      passwordHash: 'hash-1',
    });

    await expect(
      repo.create({
        email: 'UNIQUE@example.com',
        passwordHash: 'hash-2',
      }),
    ).rejects.toThrow();
  });

  it('manages refresh token lifecycle (create, find, revoke, cascade)', async () => {
    const user = await repo.create({
      email: 'user-token@example.com',
      passwordHash: 'hash',
    });

    const rawToken = 'sample-refresh-token-xyz';
    const tokenHash = hashToken(rawToken);
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const createdToken = await repo.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt: in7Days,
    });

    expect(createdToken.id).toBeDefined();
    expect(createdToken.userId).toBe(user.id);
    expect(createdToken.revokedAt).toBeNull();

    const found = await repo.findRefreshToken(tokenHash);
    expect(found).not.toBeNull();
    expect(found?.tokenHash).toBe(tokenHash);
    expect(found?.revokedAt).toBeNull();

    // Revoke token
    const revoked = await repo.revokeRefreshToken(tokenHash);
    expect(revoked).toBe(true);

    const foundAfter = await repo.findRefreshToken(tokenHash);
    expect(foundAfter?.revokedAt).not.toBeNull();

    // Re-revoking returns false
    const reRevoked = await repo.revokeRefreshToken(tokenHash);
    expect(reRevoked).toBe(false);

    // Cascade delete on user
    await pool.query('DELETE FROM users WHERE id = $1;', [user.id]);
    const afterUserDelete = await repo.findRefreshToken(tokenHash);
    expect(afterUserDelete).toBeNull();
  });
});
