import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, AuthUser } from '../types';

/** The authenticated user set by `JwtAuthGuard`; `@CurrentUser('userId')` picks one field. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | string => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? user?.[field] : user;
  },
);
