import { UserId } from '../../../shared/domain/typed-id';

export type UserRole = 'user' | 'admin';

export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly createdAt: Date;
}

export interface RefreshToken {
  readonly id: string;
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}
