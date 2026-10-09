import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UnauthorizedException } from '../../../common/exceptions';
import { AuthenticatedRequest } from '../../../common/types';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }

    req.user = await this.authService.authenticate(token);

    return true;
  }
}
