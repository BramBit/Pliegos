import {
  Inject,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../../domain/ports/user.repository.port';
import { verifyPassword } from '../../infrastructure/security/password-hasher';
import {
  generateRefreshTokenString,
  hashToken,
} from '../../infrastructure/security/token-hasher';
import { LoginThrottlerService } from '../../infrastructure/security/login-throttler.service';

export interface LoginInput {
  email: string;
  password: string;
  ip: string;
}

export interface AuthTokensOutput {
  accessToken: string;
  refreshToken: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository: UserRepositoryPort,
    private readonly jwtService: JwtService,
    private readonly loginThrottler: LoginThrottlerService,
  ) {}

  async execute(input: LoginInput): Promise<AuthTokensOutput> {
    const cleanEmail = input.email.trim().toLowerCase();
    const cleanIp = input.ip.trim();

    if (this.loginThrottler.isBlocked(cleanIp, cleanEmail)) {
      throw new HttpException(
        'Too many failed login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepository.findByEmail(cleanEmail);
    if (!user) {
      this.loginThrottler.recordFailure(cleanIp, cleanEmail);
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await verifyPassword(
      input.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      this.loginThrottler.recordFailure(cleanIp, cleanEmail);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.loginThrottler.recordSuccess(cleanIp, cleanEmail);

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    const rawRefreshToken = generateRefreshTokenString();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    await this.userRepository.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }
}
