import { Inject, Injectable } from '@nestjs/common';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../../domain/ports/user.repository.port';
import { hashToken } from '../../infrastructure/security/token-hasher';

export interface LogoutOutput {
  success: boolean;
  message: string;
}

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  async execute(input: { refreshToken?: string }): Promise<LogoutOutput> {
    if (input.refreshToken && input.refreshToken.trim() !== '') {
      const tokenHash = hashToken(input.refreshToken.trim());
      await this.userRepository.revokeRefreshToken(tokenHash);
    }

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
