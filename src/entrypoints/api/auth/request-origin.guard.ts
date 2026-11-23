import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { SAFE_HTTP_METHODS } from '../../../common/constants';
import {
  JsonBodyRequiredUnsupportedMediaTypeException,
  OriginNotAllowedForbiddenException,
} from '../../../common/exceptions';
import { ApiConfigService } from '../../../configs/api-config/api-config.service';

/**
 * First line against cross-site requests, on every route (public ones too, the sign-in): an unsafe
 * request must come from an allowed origin (`Origin`, or `Sec-Fetch-Site` when a browser sent no
 * origin) and carry a JSON body, which a cross-site form cannot send.
 */
@Injectable()
export class RequestOriginGuard implements CanActivate {
  constructor(private readonly apiConfig: ApiConfigService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_HTTP_METHODS.includes(request.method)) {
      return true;
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined
        ? !this.apiConfig.isOriginAllowed(origin)
        : request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new OriginNotAllowedForbiddenException();
    }
    if (RequestOriginGuard.hasBody(request) && !request.is('application/json')) {
      throw new JsonBodyRequiredUnsupportedMediaTypeException();
    }
    return true;
  }

  private static hasBody(request: Request): boolean {
    const length = request.headers['content-length'];
    return (
      request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')
    );
  }
}
