import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../domain/entities/user.entity';

export interface CurrentUserPayload {
  sub: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
