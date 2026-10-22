import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../../domain/ports/user.repository.port';
import {
  generateRefreshTokenString,
  hashToken,
} from '../../infrastructure/security/token-hasher';
import { AuthTokensOutput } from './login.use-case';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository: UserRepositoryPort,
    private readonly jwtService: JwtService,
  ) {}

  async execute(input: { refreshToken: string }): Promise<AuthTokensOutput> {
    if (!input.refreshToken || input.refreshToken.trim() === '') {
      throw new UnauthorizedException('Missing refresh token');
    }

    const tokenHash = hashToken(input.refreshToken.trim());
    const storedToken = await this.userRepository.findRefreshToken(tokenHash);

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (storedToken.revokedAt !== null) {
      throw new UnauthorizedException('Refresh token has already been revoked');
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Rotation: revoke the old token immediately
    await this.userRepository.revokeRefreshToken(tokenHash);

    const user = await this.userRepository.findById(storedToken.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Issue new access token and new refresh token
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    const newRawRefreshToken = generateRefreshTokenString();
    const newTokenHash = hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    await this.userRepository.createRefreshToken({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    };
  }
}
