import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, SAFE_HTTP_METHODS } from '../../../common/constants';
import {
  CsrfTokenForbiddenException,
  SessionRequiredUnauthorizedException,
} from '../../../common/exceptions';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { AuthenticatedRequest } from './current-session.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Every route needs the session `SessionGuard` found (401 without one) unless `@Public()`, and an
 * unsafe method the CSRF token of that session in `X-CSRF-Token` (403).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.authSession;
    if (!session) {
      throw new SessionRequiredUnauthorizedException();
    }
    if (
      !SAFE_HTTP_METHODS.includes(request.method) &&
      !this.authService.isCsrfTokenValid(session.tokenHash, request.headers[CSRF_HEADER])
    ) {
      throw new CsrfTokenForbiddenException();
    }
    return true;
  }
}
