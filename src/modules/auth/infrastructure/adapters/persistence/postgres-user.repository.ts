import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  UserRepositoryPort,
  CreateUserProps,
  CreateRefreshTokenProps,
} from '../../../domain/ports/user.repository.port';
import {
  User,
  UserRole,
  RefreshToken,
} from '../../../domain/entities/user.entity';
import { UserId, asUserId } from '../../../../shared/domain/typed-id';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date | string;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

@Injectable()
export class PostgresUserRepository implements UserRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(props: CreateUserProps): Promise<User> {
    const role = props.role ?? 'user';
    const query = `
      INSERT INTO users (email, password_hash, role)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const res: QueryResult<UserRow> = await this.pool.query(query, [
      props.email.trim().toLowerCase(),
      props.passwordHash,
      role,
    ]);
    return this.mapUserRow(res.rows[0]);
  }

  async findByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE lower(email) = lower($1);';
    const res: QueryResult<UserRow> = await this.pool.query(query, [
      email.trim(),
    ]);
    if (res.rows.length === 0) return null;
    return this.mapUserRow(res.rows[0]);
  }

  async findById(id: UserId): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1;';
    const res: QueryResult<UserRow> = await this.pool.query(query, [id]);
    if (res.rows.length === 0) return null;
    return this.mapUserRow(res.rows[0]);
  }

  async createRefreshToken(
    props: CreateRefreshTokenProps,
  ): Promise<RefreshToken> {
    const query = `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const res: QueryResult<RefreshTokenRow> = await this.pool.query(query, [
      props.userId,
      props.tokenHash,
      props.expiresAt,
    ]);
    return this.mapRefreshTokenRow(res.rows[0]);
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    const query = 'SELECT * FROM refresh_tokens WHERE token_hash = $1;';
    const res: QueryResult<RefreshTokenRow> = await this.pool.query(query, [
      tokenHash,
    ]);
    if (res.rows.length === 0) return null;
    return this.mapRefreshTokenRow(res.rows[0]);
  }

  async revokeRefreshToken(tokenHash: string): Promise<boolean> {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1 AND revoked_at IS NULL;
    `;
    const res = await this.pool.query(query, [tokenHash]);
    return (res.rowCount ?? 0) > 0;
  }

  async revokeAllUserRefreshTokens(userId: UserId): Promise<void> {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND revoked_at IS NULL;
    `;
    await this.pool.query(query, [userId]);
  }

  private mapUserRow(row: UserRow): User {
    return {
      id: asUserId(row.id),
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at),
    };
  }

  private mapRefreshTokenRow(row: RefreshTokenRow): RefreshToken {
    return {
      id: row.id,
      userId: asUserId(row.user_id),
      tokenHash: row.token_hash,
      expiresAt: new Date(row.expires_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      createdAt: new Date(row.created_at),
    };
  }
}
