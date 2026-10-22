import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RegisterUseCase } from '../../application/use-cases/register.use-case';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case';
import { Public } from '../security/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../security/current-user.decorator';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../../domain/ports/user.repository.port';
import { asUserId } from '../../../shared/domain/typed-id';

interface RequestLike {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { ErrorEnvelopeDto } from '../../../shared/infrastructure/http/response.dtos';
import {
  RegisterDto,
  RegisterResponseDto,
  registerSchema,
  LoginDto,
  AuthTokensResponseDto,
  loginSchema,
  RefreshTokenDto,
  refreshTokenSchema,
  LogoutDto,
  LogoutResponseDto,
  logoutSchema,
  CurrentUserResponseDto,
} from './dtos/auth.dtos';

import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository?: UserRepositoryPort,
  ) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener información del usuario autenticado',
    description: 'Retorna el identificador, correo y rol del usuario actualmente autenticado.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Información del usuario autenticado',
    type: CurrentUserResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Token inválido o usuario no encontrado',
    type: ErrorEnvelopeDto,
  })
  async me(@CurrentUser() user: CurrentUserPayload): Promise<CurrentUserResponseDto> {
    if (!this.userRepository) {
      return { id: user.sub, email: '', role: user.role };
    }
    const found = await this.userRepository.findById(asUserId(user.sub));
    if (!found) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: found.id,
      email: found.email,
      role: found.role,
    };
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un nuevo usuario',
    description:
      'Crea una nueva cuenta de usuario con correo electrónico y contraseña (mínimo 10 caracteres).',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Usuario registrado exitosamente',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Correo inválido, contraseña muy corta o correo ya registrado',
    type: ErrorEnvelopeDto,
  })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterDto,
  ): Promise<RegisterResponseDto> {
    return this.registerUseCase.execute({
      email: body.email,
      password: body.password,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión con credenciales',
    description:
      'Valida correo y contraseña. Retorna un accessToken JWT (15 minutos) y un refreshToken rotativo (7 días). Máximo 5 intentos fallidos cada 15 minutos por correo e IP.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sesión iniciada exitosamente',
    type: AuthTokensResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Correo o contraseña incorrectos',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Demasiados intentos fallidos. Por favor espere 15 minutos.',
    type: ErrorEnvelopeDto,
  })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
    @Req() req: RequestLike,
  ): Promise<AuthTokensResponseDto> {
    const rawForwarded = req.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(rawForwarded) ? rawForwarded[0] : rawForwarded;
    const ip = (forwardedIp?.split(',')[0]?.trim()) || req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      ip,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotar tokens con refresh token',
    description:
      'Emite un nuevo par de accessToken y refreshToken. El refreshToken anterior queda revocado inmediatamente (detección de reúso).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tokens renovados exitosamente',
    type: AuthTokensResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Refresh token inválido, expirado o revocado',
    type: ErrorEnvelopeDto,
  })
  async refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenDto,
  ): Promise<AuthTokensResponseDto> {
    return this.refreshTokenUseCase.execute({
      refreshToken: body.refreshToken,
    });
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar sesión',
    description: 'Revoca el refreshToken para invalidar la sesión actual.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sesión cerrada exitosamente',
    type: LogoutResponseDto,
  })
  async logout(
    @Body(new ZodValidationPipe(logoutSchema)) body: LogoutDto,
  ): Promise<LogoutResponseDto> {
    return this.logoutUseCase.execute({
      refreshToken: body.refreshToken,
    });
  }
}
