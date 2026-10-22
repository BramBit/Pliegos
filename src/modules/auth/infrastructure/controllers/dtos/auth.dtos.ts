import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters long'),
});

export type RegisterInputDto = z.infer<typeof registerSchema>;

export class RegisterDto {
  @ApiProperty({ example: 'contratista@empresa.com' })
  email!: string;

  @ApiProperty({ example: 'ContraseñaSegura2026!', minLength: 10 })
  password!: string;
}

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInputDto = z.infer<typeof loginSchema>;

export class LoginDto {
  @ApiProperty({ example: 'contratista@empresa.com' })
  email!: string;

  @ApiProperty({ example: 'ContraseñaSegura2026!' })
  password!: string;
}

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenInputDto = z.infer<typeof refreshTokenSchema>;

export class RefreshTokenDto {
  @ApiProperty({ example: 'a1b2c3d4e5f6...refresh-token-string' })
  refreshToken!: string;
}

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export type LogoutInputDto = z.infer<typeof logoutSchema>;

export class LogoutDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4e5f6...refresh-token-string' })
  refreshToken?: string;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1' })
  id!: string;

  @ApiProperty({ example: 'contratista@empresa.com' })
  email!: string;
}

export class AuthTokensResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6...refresh-token-string' })
  refreshToken!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Logged out successfully' })
  message!: string;
}

export class CurrentUserResponseDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000001' })
  id!: string;

  @ApiProperty({ example: 'usuario@empresa.com' })
  email!: string;

  @ApiProperty({ example: 'user', enum: ['user', 'admin'] })
  role!: string;
}
