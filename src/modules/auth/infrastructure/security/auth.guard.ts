import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import { CurrentUserPayload } from './current-user.decorator';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  path?: string;
  url?: string;
  user?: CurrentUserPayload;
  [key: string]: any;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = request.path || request.url || '';

    const isAuthMe = path === '/auth/me' || path.startsWith('/auth/me');
    if (
      !isAuthMe &&
      (isPublic ||
        path.startsWith('/auth') ||
        path.startsWith('/health') ||
        path.startsWith('/reference') ||
        path === '/api-json')
    ) {
      return true;
    }

    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      const payload = await this.jwtService.verifyAsync<CurrentUserPayload>(token);
      request['user'] = {
        sub: payload.sub,
        role: payload.role,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractTokenFromHeader(request: RequestLike): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;
    const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const [type, token] = raw.split(' ');
    return type === 'Bearer' && token ? token : undefined;
  }
}
