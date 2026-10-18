import { User, UserRole, RefreshToken } from '../entities/user.entity';
import { UserId } from '../../../shared/domain/typed-id';

export interface CreateUserProps {
  readonly email: string;
  readonly passwordHash: string;
  readonly role?: UserRole;
}

export interface CreateRefreshTokenProps {
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface UserRepositoryPort {
  create(props: CreateUserProps): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: UserId): Promise<User | null>;
  createRefreshToken(props: CreateRefreshTokenProps): Promise<RefreshToken>;
  findRefreshToken(tokenHash: string): Promise<RefreshToken | null>;
  revokeRefreshToken(tokenHash: string): Promise<boolean>;
  revokeAllUserRefreshTokens(userId: UserId): Promise<void>;
}

export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');
