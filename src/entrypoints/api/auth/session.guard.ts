import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AppError, SessionUnavailableException } from '../../../common/exceptions';
import { setCurrentUserId } from '../../../common/logger';
import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { AuthenticatedRequest } from './current-session.decorator';

/**
 * Reads the session cookie on every route and, for a live session, puts it onto the request
 * (`@CurrentSession()`) and its user into the request context (`getCurrentUserId`). Never refuses:
 * the rate limits run next and count a signed-in client by its email, and `AuthGuard` then
 * requires the session where a route needs one. When the session cannot be read (Redis or the
 * database down), 503: a 401 would sign the web app out. An `AppError` keeps its own status.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger(SessionGuard.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authConfig: AuthConfigService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.authService
      .authenticate(request.cookies?.[this.authConfig.cookieName])
      .catch((error: Error) => {
        if (error instanceof AppError) {
          throw error;
        }
        this.logger.error(`Session lookup failed: ${error.message}`);
        throw new SessionUnavailableException();
      });
    if (session) {
      request.authSession = session;
      setCurrentUserId(session.user.id);
    }
    return true;
  }
}
