import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './types';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.authUser || {
      user: 'Administrator',
      roles: ['System Manager', 'All'],
      isGuest: false,
    };
  },
);
