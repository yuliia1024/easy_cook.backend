import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { SessionRequiredUnauthorizedException } from '../../../common/exceptions';
import { AuthenticatedSession } from '../../../modules/services/auth/auth.service';

/** A request with a live session carries it (`SessionGuard`). */
export type AuthenticatedRequest = Request & { authSession?: AuthenticatedSession };

/** The session `SessionGuard` read; 401 on a route that has none (a public one). */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<AuthenticatedRequest>().authSession;
    if (!session) {
      throw new SessionRequiredUnauthorizedException();
    }
    return session;
  },
);
